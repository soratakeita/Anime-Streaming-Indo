// netlify/functions/robots.js - dynamic robots.txt agar Sitemap URL sesuai domain (.com vs netlify.app)
export const handler = async (event) => {
  const h = event.headers || {};
  const host = h["x-forwarded-host"] || h.host || h.Host || "";
  const proto = h["x-forwarded-proto"] || (host.includes("localhost") ? "http" : "https");
  const site = host ? `${proto}://${host}`.replace(/\/$/, "") : (process.env.SITE_URL || process.env.URL || "https://aiasubs.netlify.app").replace(/\/$/, "");
  const body = `User-agent: *
Allow: /
Disallow: /api/
Disallow: /img-proxy

# Sitemap
Sitemap: ${site}/sitemap.xml
`;
  return {
    statusCode: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
    body,
  };
};
