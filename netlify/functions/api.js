// netlify/functions/api.js

const TARGET_BASE = "https://apps.animekita.org";
const API_PATH = "/api/v1.2.5";
const RETRY_COUNT = 2;
const RETRY_DELAY_MS = 800;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Cache sederhana di memory function (warm container) untuk redam 403 setelah push
// Setelah push, Netlify cold start -> banyak user hit upstream bersamaan -> rate-limit -> 403
// Cache hit tidak hit upstream sama sekali
const memCache = new Map(); // key -> { body, contentType, ts, ttl }
const inflight = new Map(); // key -> Promise untuk coalesce burst request

function getCacheTTL(path) {
  if (path.includes("home/ongoing.php")) return 60 * 1000; // 1 menit
  if (path.includes("jadwal.php")) return 5 * 60 * 1000;
  if (path.includes("anime-list.php")) return 5 * 60 * 1000;
  if (path.includes("search.php")) return 30 * 1000;
  if (path.includes("series.php") || path.includes("seriesSimple.php")) return 3 * 60 * 1000;
  if (path.includes("episode/data.php")) return 60 * 1000;
  if (path.includes("genreseries.php")) return 2 * 60 * 1000;
  return 60 * 1000;
}
function getCached(key) {
  const e = memCache.get(key);
  if (!e) return null;
  if (Date.now() - e.ts > e.ttl) {
    // stale tapi masih bisa dipakai sebagai fallback saat 403
    return { ...e, stale: true };
  }
  return { ...e, stale: false };
}
function setCached(key, body, contentType, ttl) {
  memCache.set(key, { body, contentType, ts: Date.now(), ttl });
  // batasi size
  if (memCache.size > 200) {
    const first = memCache.keys().next().value;
    memCache.delete(first);
  }
}

function getDynamicReferer(path, query) {
  try {
    // episode detail paling spesifik dulu
    if (path.includes("series/episode/data.php") || path.includes("episode/data.php")) {
      const ep = query.url || query.id || "";
      if (ep) return `https://animekita.org/anime/${ep}`;
    }
    if (path.includes("genreseries.php")) {
      const genre = query.url || query.genre || "";
      if (genre) return `https://animekita.org/genre/${genre}`;
    }
    if (path.includes("series.php") || path.includes("seriesSimple.php")) {
      const slug = query.url || query.id || "";
      if (slug) return `https://animekita.org/anime/${slug}`;
    }
    if (path.includes("search.php")) {
      const kw = query.keyword || query.q || "";
      if (kw) return `https://animekita.org/search/${encodeURIComponent(kw)}`;
    }
  } catch {}
  return "https://animekita.org/";
}

function isHtml403(text) {
  return text && text.trim().startsWith("<!DOCTYPE") && text.includes("403 Forbidden");
}

exports.handler = async function (event, context) {
  // Support both Netlify redirect (/api/*) and direct function call (/.netlify/functions/api)
  let path = event.path.replace(/^\/\.netlify\/functions\/api\/?/, "").replace(/^\/api\/?/, "");
  
  // Rekonstruksi query parameters jika ada
  const queryParams = new URLSearchParams(event.queryStringParameters || {}).toString();
  const targetUrl = `${TARGET_BASE}${API_PATH}/${path}${queryParams ? "?" + queryParams : ""}`;
  const cacheKey = `${event.httpMethod}:${path}?${queryParams}`;
  const ttl = getCacheTTL(path);

  console.log(`[Netlify Proxy] ${event.httpMethod} ${event.path} -> ${targetUrl} (ttl ${ttl}ms)`);

  // CORS preflight - jangan cache
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      },
      body: "",
    };
  }

  // 1) Cek cache sebelum hit upstream - ini yang cegah burst 403 setelah push
  const cached = getCached(cacheKey);
  if (cached && !cached.stale && event.httpMethod === "GET") {
    console.log(`[Netlify Proxy] CACHE HIT ${cacheKey}`);
    return {
      statusCode: 200,
      headers: {
        "Content-Type": cached.contentType,
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Cache-Control": `public, max-age=${Math.floor(ttl / 1000)}, s-maxage=${Math.floor(ttl / 1000)}`,
        "X-Cache": "HIT",
        "X-Cache-Stale": "false",
      },
      body: cached.body,
    };
  }
  // coalesce: jika ada request sama yang lagi inflight, tunggu itu (cegah 10 request barengan setelah push)
  if (inflight.has(cacheKey)) {
    console.log(`[Netlify Proxy] COALESCE wait ${cacheKey}`);
    try {
      const r = await inflight.get(cacheKey);
      return r;
    } catch {}
  }

  // buat promise untuk coalesce
  const fetchPromise = (async () => {
    let lastResponse = null;
    let lastError = null;

    for (let attempt = 0; attempt <= RETRY_COUNT; attempt++) {
    try {
      // Jitter delay untuk retry agar tidak barengan trigger rate-limit
      if (attempt > 0) {
        const delay = RETRY_DELAY_MS * attempt + Math.random() * 500;
        console.log(`[Netlify Proxy] Retry ${attempt}/${RETRY_COUNT} after ${Math.round(delay)}ms`);
        await sleep(delay);
      }

      const qp = event.queryStringParameters || {};
      let dynamicReferer = getDynamicReferer(path, qp);
      // Retry fallback: jika attempt >0, coba alternatif referer
      if (attempt > 0) {
        // flip: jika spesifik -> generic, jika generic -> spesifik
        if (dynamicReferer === "https://animekita.org/") {
          const fallback = qp.url || qp.keyword || qp.q || "test";
          dynamicReferer = `https://animekita.org/anime/${fallback}`;
        } else {
          dynamicReferer = "https://animekita.org/";
        }
        console.log(`[Netlify Proxy] Retry with fallback Referer: ${dynamicReferer}`);
      }
      const headers = {
        "Referer": dynamicReferer,
        "Origin": "https://animekita.org",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "id-ID,id;q=0.9,en;q=0.8",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "X-Requested-With": "XMLHttpRequest",
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-Mode": "cors",
      };

      // Forward content-type hanya untuk POST/PUT
      const reqContentType = event.headers["content-type"] || event.headers["Content-Type"];
      if (reqContentType && event.httpMethod !== "GET" && event.httpMethod !== "HEAD") {
        headers["Content-Type"] = reqContentType;
      }

      const response = await fetch(targetUrl, {
        method: event.httpMethod,
        headers,
        body: event.body && event.httpMethod !== "GET" && event.httpMethod !== "HEAD" ? event.body : undefined,
      });

      const contentType = response.headers.get("content-type") || "application/json";
      const data = await response.text();

      // Deteksi HTML 403 yang dibungkus status 200 (kadang Cloudflare) atau status 403
      if (isHtml403(data) && attempt < RETRY_COUNT) {
        console.warn(`[Netlify Proxy] Got HTML 403, will retry with fallback referer...`);
        lastResponse = response;
        continue;
      }
      if ([403, 429, 502, 503, 504].includes(response.status) && attempt < RETRY_COUNT) {
        console.warn(`[Netlify Proxy] Got ${response.status}, will retry...`);
        lastResponse = response;
        continue;
      }

      // Jika sukses tapi body ternyata HTML 403, ubah jadi JSON error agar frontend tidak parse gagal
      if (isHtml403(data)) {
        return {
          statusCode: 502,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-cache",
          },
          body: JSON.stringify({ error: "Upstream blocked (403). Coba refresh beberapa detik lagi.", upstream: "403 Forbidden" }),
        };
      }

      return {
        statusCode: response.status,
        headers: {
          "Content-Type": contentType,
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
          "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
          "Cache-Control": response.status === 200 ? "public, max-age=300" : "no-cache",
        },
        body: data
      };
    } catch (error) {
      console.error(`[Netlify Proxy Error] attempt ${attempt}:`, error.message);
      lastError = error;
      if (attempt === RETRY_COUNT) break;
    }
  }

  // Jika semua retry gagal tapi ada lastResponse (403/429), kembalikan JSON agar frontend tidak dapat HTML
  if (lastResponse) {
    const data = await lastResponse.text().catch(() => "");
    if (isHtml403(data)) {
      return {
        statusCode: 502,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ error: "Upstream blocked (403). Server animekita sedang memblokir request. Coba lagi 5 detik.", upstream: "403" }),
      };
    }
    return {
      statusCode: lastResponse.status,
      headers: {
        "Content-Type": lastResponse.headers.get("content-type") || "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: data || JSON.stringify({ error: `Upstream ${lastResponse.status} after ${RETRY_COUNT} retries` }),
    };
  }

  return {
    statusCode: 502,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    },
    body: JSON.stringify({ error: lastError?.message || "Proxy failed after retries" })
  };
  })();

  // simpan untuk coalesce
  if (event.httpMethod === "GET") inflight.set(cacheKey, fetchPromise);

  try {
    const result = await fetchPromise;
    // jika upstream 502/403 tapi kita punya stale, kembalikan stale biar user tidak lihat error setelah push
    if (result.statusCode >= 400) {
      const stale = getCached(cacheKey);
      if (stale && stale.body) {
        console.warn(`[Netlify Proxy] Serving STALE cache for ${cacheKey} due to ${result.statusCode}`);
        return {
          statusCode: 200,
          headers: {
            "Content-Type": stale.contentType,
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "public, max-age=10, stale-while-revalidate=60",
            "X-Cache": "STALE",
            "X-Cache-Stale": "true",
          },
          body: stale.body,
        };
      }
    }
    // simpan ke cache jika sukses 200 JSON (jangan cache error/HTML)
    if (result.statusCode === 200 && event.httpMethod === "GET" && result.body && !isHtml403(result.body)) {
      const ct = result.headers["Content-Type"] || "application/json";
      if (ct.includes("application/json")) {
        setCached(cacheKey, result.body, ct, ttl);
        result.headers["X-Cache"] = "MISS";
        // Netlify edge cache: s-maxage untuk CDN, max-age untuk browser
        result.headers["Cache-Control"] = `public, max-age=${Math.floor(ttl / 1000)}, s-maxage=${Math.floor(ttl / 1000)}, stale-while-revalidate=60`;
        result.headers["Netlify-CDN-Cache-Control"] = `public, s-maxage=${Math.floor(ttl / 1000)}, stale-while-revalidate=60`;
      }
    }
    return result;
  } catch (e) {
    // fallback stale cache saat error total
    const stale = getCached(cacheKey);
    if (stale) {
      console.warn(`[Netlify Proxy] Fallback stale cache for ${cacheKey} after error: ${e.message}`);
      return {
        statusCode: 200,
        headers: {
          "Content-Type": stale.contentType,
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=10, stale-while-revalidate=60",
          "X-Cache": "STALE",
          "X-Cache-Stale": "true",
        },
        body: stale.body,
      };
    }
    throw e;
  } finally {
    inflight.delete(cacheKey);
  }
};
