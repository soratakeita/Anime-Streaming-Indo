// netlify/functions/api.js

const TARGET_BASE = "https://apps.animekita.org";
const API_PATH = "/api/v1.2.5";
const RETRY_COUNT = 2;
const RETRY_DELAY_MS = 800;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Node fetch terdeteksi bot via JA3, curl lebih lolos untuk series.php
// Fallback ke curl jika fetch 403
import { execFile } from "child_process";
import { promisify } from "util";
const execFileAsync = promisify(execFile);
const ANDROID_UA = "Mozilla/5.0 (Linux; Android 11; Redmi Note 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36";

async function curlFetch(url, headers) {
  const curlBin = process.platform === "win32" ? "curl.exe" : "curl";
  const args = ["-s", "-i", "-L", "--max-time", "15", url];
  for (const [k, v] of Object.entries(headers)) {
    args.push("-H", `${k}: ${v}`);
  }
  try {
    const { stdout } = await execFileAsync(curlBin, args, { maxBuffer: 10 * 1024 * 1024 });
    // split header/body: last \r\n\r\n is body
    const parts = stdout.split("\r\n\r\n");
    const body = parts.pop() || "";
    const headerText = parts.pop() || "";
    const statusMatch = headerText.match(/HTTP\/[\d.]+\s+(\d+)/);
    const status = statusMatch ? parseInt(statusMatch[1], 10) : 200;
    const ctMatch = headerText.match(/content-type:\s*([^\r\n]+)/i);
    const contentType = ctMatch ? ctMatch[1].trim() : "application/json";
    return { status, body, contentType, headers: {} };
  } catch (e) {
    throw new Error(`curl failed: ${e.message}`);
  }
}

// ============ CACHE L1: MEMORY (warm container) ============
// ============ CACHE L2: TURSO LIBSQL (persisten 1x hit) ============
const TURSO_URL = process.env.TURSO_DATABASE_URL || process.env.VITE_TURSO_URL || "libsql://aiasubs-soratakeita.aws-ap-northeast-1.turso.io";
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN || process.env.TURSO_TOKEN || process.env.VITE_TURSO_AUTH_TOKEN || "";

const memCache = new Map(); // key -> { body, contentType, ts, ttl }
const inflight = new Map(); // key -> Promise untuk coalesce burst request

let tursoClient = null;
let tursoReady = false;

async function getTurso() {
  if (!TURSO_TOKEN) return null;
  if (tursoClient) return tursoClient;
  try {
    const { createClient } = await import("@libsql/client");
    tursoClient = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN });
    if (!tursoReady) {
      await tursoClient.execute(`
        CREATE TABLE IF NOT EXISTS api_cache (
          cache_key TEXT PRIMARY KEY,
          body TEXT NOT NULL,
          content_type TEXT,
          created_at INTEGER NOT NULL,
          ttl INTEGER NOT NULL
        )
      `);
      // index untuk cleanup
      await tursoClient.execute(`CREATE INDEX IF NOT EXISTS idx_api_cache_created ON api_cache(created_at)`);
      tursoReady = true;
      console.log("[Turso] table ready");
    }
    return tursoClient;
  } catch (e) {
    console.warn("[Turso] init failed, fallback memory:", e.message);
    return null;
  }
}

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
function getMemCached(key) {
  const e = memCache.get(key);
  if (!e) return null;
  if (Date.now() - e.ts > e.ttl) {
    return { ...e, stale: true };
  }
  return { ...e, stale: false };
}
function setMemCached(key, body, contentType, ttl) {
  memCache.set(key, { body, contentType, ts: Date.now(), ttl });
  if (memCache.size > 200) {
    const first = memCache.keys().next().value;
    memCache.delete(first);
  }
}

async function getDbCached(key) {
  const client = await getTurso();
  if (!client) return null;
  try {
    const rs = await client.execute({ sql: "SELECT body, content_type, created_at, ttl FROM api_cache WHERE cache_key = ?", args: [key] });
    if (rs.rows.length === 0) return null;
    const row = rs.rows[0];
    const age = Date.now() - Number(row.created_at);
    const ttl = Number(row.ttl);
    const stale = age > ttl;
    return { body: row.body, contentType: row.content_type, ts: Number(row.created_at), ttl, stale };
  } catch (e) {
    console.warn("[Turso] get failed:", e.message);
    return null;
  }
}
async function setDbCached(key, body, contentType, ttl) {
  const client = await getTurso();
  if (!client) return;
  try {
    await client.execute({
      sql: "INSERT OR REPLACE INTO api_cache (cache_key, body, content_type, created_at, ttl) VALUES (?, ?, ?, ?, ?)",
      args: [key, body, contentType, Date.now(), ttl],
    });
  } catch (e) {
    console.warn("[Turso] set failed:", e.message);
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

export const handler = async (event, context) => {
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

  // 1) Cek L1 memory, lalu L2 Turso (1x hit). Ini yang bikin 1x hit upstream saja.
  const mem = getMemCached(cacheKey);
  if (mem && !mem.stale && event.httpMethod === "GET") {
    console.log(`[Netlify Proxy] L1 HIT ${cacheKey}`);
    return {
      statusCode: 200,
      headers: {
        "Content-Type": mem.contentType,
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Cache-Control": `public, max-age=${Math.floor(ttl / 1000)}, s-maxage=${Math.floor(ttl / 1000)}`,
        "X-Cache": "HIT-L1",
        "X-Cache-Stale": "false",
      },
      body: mem.body,
    };
  }
  if (event.httpMethod === "GET") {
    const db = await getDbCached(cacheKey);
    if (db && !db.stale) {
      console.log(`[Netlify Proxy] L2 HIT (Turso) ${cacheKey}`);
      setMemCached(cacheKey, db.body, db.contentType, ttl); // warm L1
      return {
        statusCode: 200,
        headers: {
          "Content-Type": db.contentType,
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
          "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
          "Cache-Control": `public, max-age=${Math.floor(ttl / 1000)}, s-maxage=${Math.floor(ttl / 1000)}`,
          "X-Cache": "HIT-L2",
          "X-Cache-Stale": "false",
        },
        body: db.body,
      };
    }
    if (db && db.stale) {
      console.log(`[Netlify Proxy] L2 STALE ${cacheKey} age ${Math.floor((Date.now()-db.ts)/1000)}s`);
      // jangan return stale langsung, simpan untuk fallback nanti, tapi coba revalidate
    }
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
        "User-Agent": ANDROID_UA,
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "id-ID,id;q=0.9,en;q=0.8",
      };

      // Forward content-type hanya untuk POST/PUT
      const reqContentType = event.headers["content-type"] || event.headers["Content-Type"];
      if (reqContentType && event.httpMethod !== "GET" && event.httpMethod !== "HEAD") {
        headers["Content-Type"] = reqContentType;
      }

      let response;
      let data;
      let contentType;
      try {
        const r = await fetch(targetUrl, {
          method: event.httpMethod,
          headers,
          body: event.body && event.httpMethod !== "GET" && event.httpMethod !== "HEAD" ? event.body : undefined,
        });
        const t = await r.text();
        // jika fetch kena 403 JA3, coba curl fallback (curl lolos untuk series.php)
        if ((r.status === 403 || isHtml403(t)) && attempt < RETRY_COUNT) {
          console.warn(`[Netlify Proxy] fetch ${r.status} HTML403=${isHtml403(t)} -> try curl fallback`);
          try {
            const curlRes = await curlFetch(targetUrl, headers);
            if (!isHtml403(curlRes.body) && curlRes.status === 200) {
              return {
                statusCode: curlRes.status,
                headers: {
                  "Content-Type": curlRes.contentType,
                  "Access-Control-Allow-Origin": "*",
                  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
                  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
                  "Cache-Control": "public, max-age=300",
                },
                body: curlRes.body,
              };
            }
            // curl juga 403, lanjut retry loop
            console.warn(`[Netlify Proxy] curl also ${curlRes.status} HTML403=${isHtml403(curlRes.body)}`);
            lastResponse = { status: curlRes.status, headers: { get: () => curlRes.contentType }, text: async () => curlRes.body };
            // simpan body untuk fallback, tapi continue retry
            response = { status: curlRes.status, headers: { get: (k) => k.toLowerCase() === "content-type" ? curlRes.contentType : null } };
            data = curlRes.body;
            contentType = curlRes.contentType;
            if (isHtml403(data) || [403,429,502,503,504].includes(response.status)) {
              continue;
            }
          } catch (curlErr) {
            console.warn(`[Netlify Proxy] curl fallback failed: ${curlErr.message}`);
          }
        }
        response = r;
        data = t;
        contentType = r.headers.get("content-type") || "application/json";
      } catch (fetchErr) {
        // network error, coba curl
        console.warn(`[Netlify Proxy] fetch threw ${fetchErr.message}, try curl`);
        try {
          const curlRes = await curlFetch(targetUrl, headers);
          return {
            statusCode: curlRes.status,
            headers: {
              "Content-Type": curlRes.contentType,
              "Access-Control-Allow-Origin": "*",
              "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
              "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
              "Cache-Control": "public, max-age=300",
            },
            body: curlRes.body,
          };
        } catch (curlErr2) {
          throw fetchErr;
        }
      }

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
    // jika upstream error, coba stale L1 lalu L2
    if (result.statusCode >= 400) {
      const s1 = getMemCached(cacheKey);
      if (s1 && s1.body) {
        console.warn(`[Netlify Proxy] Serving STALE L1 for ${cacheKey} due to ${result.statusCode}`);
        return {
          statusCode: 200,
          headers: {
            "Content-Type": s1.contentType,
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "public, max-age=10, stale-while-revalidate=60",
            "X-Cache": "STALE-L1",
            "X-Cache-Stale": "true",
          },
          body: s1.body,
        };
      }
      const s2 = await getDbCached(cacheKey);
      if (s2 && s2.body) {
        console.warn(`[Netlify Proxy] Serving STALE L2 for ${cacheKey} due to ${result.statusCode}`);
        setMemCached(cacheKey, s2.body, s2.contentType, ttl);
        return {
          statusCode: 200,
          headers: {
            "Content-Type": s2.contentType,
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "public, max-age=10, stale-while-revalidate=60",
            "X-Cache": "STALE-L2",
            "X-Cache-Stale": "true",
          },
          body: s2.body,
        };
      }
    }
    // simpan ke L1 + L2 jika sukses 200 JSON (jangan cache error/HTML)
    if (result.statusCode === 200 && event.httpMethod === "GET" && result.body && !isHtml403(result.body)) {
      const ct = result.headers["Content-Type"] || "application/json";
      if (ct.includes("application/json")) {
        setMemCached(cacheKey, result.body, ct, ttl);
        // fire-and-forget ke Turso biar request tidak lambat
        setDbCached(cacheKey, result.body, ct, ttl).catch(() => {});
        result.headers["X-Cache"] = "MISS";
        result.headers["Cache-Control"] = `public, max-age=${Math.floor(ttl / 1000)}, s-maxage=${Math.floor(ttl / 1000)}, stale-while-revalidate=60`;
        result.headers["Netlify-CDN-Cache-Control"] = `public, s-maxage=${Math.floor(ttl / 1000)}, stale-while-revalidate=60`;
      }
    }
    return result;
  } catch (e) {
    const s1 = getMemCached(cacheKey);
    if (s1) {
      console.warn(`[Netlify Proxy] Fallback STALE L1 after error: ${e.message}`);
      return {
        statusCode: 200,
        headers: {
          "Content-Type": s1.contentType,
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=10, stale-while-revalidate=60",
          "X-Cache": "STALE-L1",
          "X-Cache-Stale": "true",
        },
        body: s1.body,
      };
    }
    const s2 = await getDbCached(cacheKey);
    if (s2) {
      console.warn(`[Netlify Proxy] Fallback STALE L2 after error: ${e.message}`);
      return {
        statusCode: 200,
        headers: {
          "Content-Type": s2.contentType,
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=10, stale-while-revalidate=60",
          "X-Cache": "STALE-L2",
          "X-Cache-Stale": "true",
        },
        body: s2.body,
      };
    }
    throw e;
  } finally {
    inflight.delete(cacheKey);
  }
};
