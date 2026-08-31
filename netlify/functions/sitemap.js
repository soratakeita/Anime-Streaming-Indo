// netlify/functions/sitemap.js - dynamic sitemap for SEO
// Generate URL list from upstream anime-list + ongoing so Google can discover /anime/:slug
// Upstream apps.animekita.org sering 403 CF challenge, jadi pakai curl fallback + Turso cache fallback

import { execFile } from "child_process";
import { promisify } from "util";
const execFileAsync = promisify(execFile);

const TARGET_BASE = "https://apps.animekita.org";
const API_PATH = "/api/v1.2.5";
const ANDROID_UA = "Mozilla/5.0 (Linux; Android 11; Redmi Note 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36";

function getSiteUrl(event) {
  // pakai host dari request agar .com vs netlify.app tidak dianggap duplikat (Bing alternate)
  const h = event.headers || {};
  const host = h["x-forwarded-host"] || h.host || h.Host || h[":authority"] || "";
  if (host) {
    const proto = h["x-forwarded-proto"] || (host.includes("localhost") ? "http" : "https");
    return `${proto}://${host}`.replace(/\/$/, "");
  }
  return (process.env.SITE_URL || process.env.URL || "https://aiasubs.netlify.app").replace(/\/$/, "");
}

function escapeXml(s) {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;");
}

function isHtml403(t) {
  return t && t.trim().startsWith("<!DOCTYPE") && t.includes("403 Forbidden");
}

async function curlFetch(url, headers) {
  const curlBin = process.platform === "win32" ? "curl.exe" : "curl";
  const args = ["-s", "-L", "--max-time", "15", url];
  for (const [k, v] of Object.entries(headers)) args.push("-H", `${k}: ${v}`);
  try {
    const { stdout } = await execFileAsync(curlBin, args, { maxBuffer: 10 * 1024 * 1024 });
    const parts = stdout.split("\r\n\r\n");
    const body = parts.pop() || "";
    if (isHtml403(body)) throw new Error("curl html 403");
    return body;
  } catch (e) { throw e; }
}

async function fetchJsonWithFallback(url, referer) {
  const headers = {
    "User-Agent": ANDROID_UA,
    Accept: "application/json, text/plain, */*",
    Referer: referer,
    "Accept-Language": "id-ID,id;q=0.9",
  };
  // coba fetch biasa
  try {
    const res = await fetch(url, { headers });
    const t = await res.text();
    if (!isHtml403(t) && res.ok) return JSON.parse(t);
    if (isHtml403(t)) throw new Error("fetch html 403");
    throw new Error(`fetch ${res.status}`);
  } catch (e) {
    // fallback curl (bypass JA3)
    try {
      const body = await curlFetch(url, headers);
      return JSON.parse(body);
    } catch (e2) { throw e2; }
  }
}

function collectSlugs(json) {
  const out = [];
  const pushArr = (arr) => {
    if (!Array.isArray(arr)) return;
    for (const a of arr) {
      const slug = a.url || a.link || a.slug || "";
      if (slug && typeof slug === "string") out.push(slug);
    }
  };
  if (Array.isArray(json)) pushArr(json);
  else if (Array.isArray(json.data)) pushArr(json.data);
  else if (json && typeof json === "object") {
    // cek alphabet keys #, A-Z
    const alphaKeys = Object.keys(json).filter(k => /^[#A-Z]$/.test(k));
    if (alphaKeys.length) {
      for (const k of alphaKeys) pushArr(json[k]);
      // juga cek jika ada nested .data di root
      if (Array.isArray(json.data)) pushArr(json.data);
    } else {
      for (const v of Object.values(json)) {
        if (Array.isArray(v)) pushArr(v);
        else if (v && Array.isArray(v.data)) pushArr(v.data);
      }
    }
  }
  return [...new Set(out)].slice(0, 5000);
}

async function getSlugsFromTurso() {
  const TURSO_URL = process.env.TURSO_DATABASE_URL || process.env.VITE_TURSO_URL || "libsql://aiasubs-soratakeita.aws-ap-northeast-1.turso.io";
  const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN || process.env.TURSO_TOKEN || process.env.VITE_TURSO_AUTH_TOKEN || "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODgxMzM1NTYsImlkIjoiMDFhMDU1MGUtZDgwMS03Yzg1LWExYWMtYWJjNWI0ZWEwNWMzIiwia2lkIjoiclZpV3pncmZ4VGRvQlVXRVZWTGpOVVpELW1jV3A2V0FzOXR2WWFTTU1LWSIsInJpZCI6IjVkODAxM2UwLTNmMzMtNDc3NS04ZDQ5LWFjMzdhZjlmNTcyMCJ9.s-onexvDVWv8Yh5jI4-Y1TaaWQgY7W2tR_Yr333j3yiGojYiGurPzbOhjI3JmFEcVtQIexwruIxlTvBQAA_AAg";
  if (!TURSO_URL || !TURSO_TOKEN) return [];
  try {
    const { createClient } = await import("@libsql/client/web");
    const httpUrl = TURSO_URL.replace(/^libsql:\/\//, "https://");
    const client = createClient({ url: httpUrl, authToken: TURSO_TOKEN });
    const slugs = new Set();
    // anime-list
    try {
      const rs = await client.execute({ sql: "SELECT body FROM api_cache WHERE cache_key LIKE ? LIMIT 1", args: ["%anime-list%"] });
      if (rs.rows.length) {
        const j = JSON.parse(rs.rows[0].body);
        // j bisa alphabet grouped atau {data:...}
        const parsed = j.data && typeof j.data === "object" && !Array.isArray(j.data) ? j.data : j;
        for (const s of collectSlugs(parsed)) slugs.add(s);
        // fallback jika grouped format: langsung Object.values
        if (slugs.size === 0) for (const s of collectSlugs(j)) slugs.add(s);
      }
    } catch (e) { console.warn("[sitemap Turso anime-list]", e.message); }
    // ongoing
    try {
      const rs2 = await client.execute({ sql: "SELECT body FROM api_cache WHERE cache_key LIKE ? LIMIT 1", args: ["%ongoing%"] });
      if (rs2.rows.length) {
        const j = JSON.parse(rs2.rows[0].body);
        const arr = Array.isArray(j) ? j : Array.isArray(j.data) ? j.data : [];
        for (const a of arr) {
          const s = a.url || a.link || "";
          if (s) slugs.add(s);
        }
      }
    } catch (e) { console.warn("[sitemap Turso ongoing]", e.message); }
    return [...slugs];
  } catch (e) {
    console.warn("[sitemap Turso init]", e.message);
    return [];
  }
}

export const handler = async (event) => {
  const SITE_URL = getSiteUrl(event || { headers: {} });
  const STATIC_URLS = [
    { loc: `${SITE_URL}/`, changefreq: "daily", priority: "1.0" },
    { loc: `${SITE_URL}/search`, changefreq: "weekly", priority: "0.6" },
  ];
  let slugs = new Set();

  // 1) coba fetch upstream (dengan curl fallback) - fresh
  try {
    const [listJson, ongoingJson] = await Promise.allSettled([
      fetchJsonWithFallback(`${TARGET_BASE}${API_PATH}/anime-list.php`, "https://animekita.org/"),
      fetchJsonWithFallback(`${TARGET_BASE}${API_PATH}/home/ongoing.php?page=1`, "https://animekita.org/"),
    ]);
    if (listJson.status === "fulfilled") for (const s of collectSlugs(listJson.value)) slugs.add(s);
    else console.warn("[sitemap] anime-list fetch failed:", listJson.reason?.message);
    if (ongoingJson.status === "fulfilled") {
      const v = ongoingJson.value;
      const arr = Array.isArray(v) ? v : Array.isArray(v?.data) ? v.data : [];
      for (const a of arr) { const s = a.url || a.link || ""; if (s) slugs.add(s); }
    } else console.warn("[sitemap] ongoing fetch failed:", ongoingJson.reason?.message);
  } catch (e) { console.warn("[sitemap] fetch outer", e.message); }

  // 2) jika kosong (karena 403 CF), fallback ke Turso cache yang sudah ada
  if (slugs.size === 0) {
    console.log("[sitemap] upstream empty, fallback Turso");
    const tursoSlugs = await getSlugsFromTurso();
    for (const s of tursoSlugs) slugs.add(s);
  }

  console.log(`[sitemap] total slugs: ${slugs.size}`);

  const now = new Date().toISOString().split("T")[0];
  const animeUrls = [...slugs].map(slug => ({ loc: `${SITE_URL}/anime/${encodeURIComponent(slug)}`, lastmod: now, changefreq: "weekly", priority: "0.8" }));

  // jika tetap 0, tetap return static biar tidak 404
  const all = [...STATIC_URLS, ...animeUrls];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${all.map(u => `  <url>
    <loc>${escapeXml(u.loc)}</loc>
    ${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ""}
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`).join("\n")}
</urlset>`;

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
      "Netlify-CDN-Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
    },
    body: xml,
  };
};
