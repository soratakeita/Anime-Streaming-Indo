// netlify/functions/sitemap.js - dynamic sitemap for SEO
// Generate URL list from upstream anime-list + ongoing so Google can discover /anime/:slug

const TARGET_BASE = "https://apps.animekita.org";
const API_PATH = "/api/v1.2.5";
const SITE_URL = (process.env.SITE_URL || process.env.URL || "https://aiasubs.netlify.app").replace(/\/$/, "");

const STATIC_URLS = [
  { loc: `${SITE_URL}/`, changefreq: "daily", priority: "1.0" },
  { loc: `${SITE_URL}/search`, changefreq: "weekly", priority: "0.6" },
];

function escapeXml(s) {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;");
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; AiaSubs-Sitemap/1.0; +https://aiasubs.netlify.app/)",
      Accept: "application/json, text/plain, */*",
      Referer: "https://animekita.org/",
    },
  });
  if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
  const t = await res.text();
  // guard HTML 403
  if (t.trim().startsWith("<!DOCTYPE")) throw new Error("upstream HTML 403");
  return JSON.parse(t);
}

function collectSlugs(json) {
  // try to normalize various shapes
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
    for (const v of Object.values(json)) {
      if (Array.isArray(v)) pushArr(v);
      else if (v && Array.isArray(v.data)) pushArr(v.data);
    }
    // also check nested data[0].result style? not needed
  }
  return [...new Set(out)].slice(0, 5000);
}

export const handler = async () => {
  let animeUrls = [];
  try {
    const [listJson, ongoingJson] = await Promise.allSettled([
      fetchJson(`${TARGET_BASE}${API_PATH}/anime-list.php`),
      fetchJson(`${TARGET_BASE}${API_PATH}/home/ongoing.php?page=1`),
    ]);
    const slugs = new Set();
    if (listJson.status === "fulfilled") {
      for (const s of collectSlugs(listJson.value)) slugs.add(s);
    }
    if (ongoingJson.status === "fulfilled") {
      const v = ongoingJson.value;
      // ongoing shape: { data: [...] } or array
      const arr = Array.isArray(v) ? v : Array.isArray(v?.data) ? v.data : [];
      for (const a of arr) {
        const s = a.url || a.link || "";
        if (s) slugs.add(s);
      }
    }
    // fallback: if both empty but we have static at least
    const now = new Date().toISOString().split("T")[0];
    for (const slug of slugs) {
      const loc = `${SITE_URL}/anime/${encodeURIComponent(slug)}`;
      animeUrls.push({ loc, lastmod: now, changefreq: "weekly", priority: "0.8" });
    }
  } catch (e) {
    console.warn("[sitemap] fetch failed:", e.message);
  }

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
