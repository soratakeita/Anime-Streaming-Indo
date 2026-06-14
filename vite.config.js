import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const TARGET = "https://apps.animekita.org";
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Linux; Android 11; Redmi Note 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36",
  Accept: "application/json",
  Referer: "https://animekita.org/",
};

const ALLOWED_IMAGE_HOSTS = [
  "assets.animekita.org",
  "i0.wp.com",
  "i1.wp.com",
  "i2.wp.com",
  "cdn.myanimelist.net",
  "myanimelist.net",
  "animekita.org",
  "otakudesu.blog",
];

const imageCache = new Map();
const IMAGE_CACHE_TTL = 24 * 60 * 60 * 1000;

let activeRequests = 0;
const MAX_CONCURRENT = 3;
const queue = [];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function resolveImageUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.match(/^i\d+\.wp\.com$/)) {
      return "https://" + parsed.pathname.slice(1).split("?")[0];
    }
  } catch {}
  return url;
}

async function fetchImage(url) {
  const resolved = resolveImageUrl(url);

  const cached = imageCache.get(resolved);
  if (cached && Date.now() - cached.timestamp < IMAGE_CACHE_TTL) {
    return cached;
  }

  if (activeRequests >= MAX_CONCURRENT) {
    await new Promise((resolve) => queue.push(resolve));
  }

  activeRequests++;
  try {
    await sleep(activeRequests * 100);

    const response = await fetch(resolved, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Linux; Android 11; Redmi Note 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36",
        Referer: "https://animekita.org/",
        Accept:
          "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "Accept-Language": "id-ID,id;q=0.9,en;q=0.8",
        "sec-fetch-dest": "image",
        "sec-fetch-mode": "no-cors",
        "sec-fetch-site": "cross-site",
      },
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const mime = response.headers.get("content-type") || "image/jpeg";

    const result = { buffer, mime, timestamp: Date.now() };
    imageCache.set(resolved, result);
    return result;
  } finally {
    activeRequests--;
    if (queue.length > 0) {
      const next = queue.shift();
      next();
    }
  }
}

export default defineConfig({
  server: {
    proxy: {
      "/api": {
        target: TARGET,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, "/api/v1.2.5"),
        headers: HEADERS,
      },
    },
  },
  plugins: [
    react(),
    {
      name: "img-proxy",
      configureServer(server) {
        server.middlewares.use("/img-proxy", async (req, res) => {
          const urlParam = new URL(
            req.url,
            "http://localhost",
          ).searchParams.get("url");
          if (!urlParam) {
            res.writeHead(400);
            return res.end("Missing url");
          }

          try {
            const host = new URL(urlParam).hostname;
            if (!ALLOWED_IMAGE_HOSTS.includes(host)) {
              res.writeHead(403);
              return res.end("Domain not allowed");
            }
          } catch {
            res.writeHead(400);
            return res.end("Invalid url");
          }

          try {
            const { buffer, mime } = await fetchImage(urlParam);
            res.writeHead(200, {
              "Content-Type": mime,
              "Cache-Control": "public, max-age=86400",
              "Content-Length": buffer.length,
            });
            res.end(buffer);
          } catch (err) {
            console.error("img-proxy error:", urlParam, err.message, err.cause);
            res.writeHead(502);
            res.end();
          }
        });
      },
    },
  ],
});
