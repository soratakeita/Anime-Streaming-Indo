// netlify/functions/api.js

const TARGET_BASE = "https://apps.animekita.org";
const API_PATH = "/api/v1.2.5";
const RETRY_COUNT = 2;
const RETRY_DELAY_MS = 800;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

  console.log(`[Netlify Proxy] ${event.httpMethod} ${event.path} -> ${targetUrl}`);

  // CORS preflight
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
};
