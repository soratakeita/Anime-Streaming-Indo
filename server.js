import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// ============================================
// KONFIGURASI
// ============================================

const TARGET_BASE = "https://apps.animekita.org";
const API_PATH = "/api/v1.2.5";

// Enable CORS untuk semua origin
app.use(cors({ origin: "*" }));

// Parse JSON body untuk POST request
app.use(express.json());

// ============================================
// IMAGE PROXY
// ============================================

const imageCache = new Map();
const IMAGE_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 jam

const ALLOWED_IMAGE_HOSTS = [
  "assets.animekita.org",
  "i0.wp.com",
  "i1.wp.com",
  "i2.wp.com",
  "cdn.myanimelist.net",
];

app.get("/img-proxy", async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: "Missing url" });

  try {
    const host = new URL(url).hostname;
    if (!ALLOWED_IMAGE_HOSTS.includes(host)) {
      return res.status(403).json({ error: "Domain not allowed" });
    }
  } catch {
    return res.status(400).json({ error: "Invalid url" });
  }

  const cached = imageCache.get(url);
  if (cached && Date.now() - cached.timestamp < IMAGE_CACHE_TTL) {
    res.set("Content-Type", cached.mime);
    res.set("Cache-Control", "public, max-age=86400");
    return res.send(cached.buffer);
  }

  try {
    const fetch = (await import("node-fetch")).default;
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Referer: "https://animekita.org/",
      },
      timeout: 10000,
    });

    if (!response.ok) return res.status(response.status).end();

    const buffer = await response.buffer();
    const mime = response.headers.get("content-type") || "image/jpeg";

    imageCache.set(url, { buffer, mime, timestamp: Date.now() });

    res.set("Content-Type", mime);
    res.set("Cache-Control", "public, max-age=86400");
    res.send(buffer);
  } catch (err) {
    console.error("Image proxy error:", err.message);
    res.status(502).end();
  }
});

// Logging middleware
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.url}`);
  next();
});

// ============================================
// HEALTH CHECK & INFO
// ============================================

app.get("/ping", (req, res) => {
  res.json({
    ok: true,
    msg: "Proxy aktif",
    timestamp: new Date().toISOString(),
    endpoints: {
      ongoing: "/api/home/ongoing.php",
      animeList: "/api/anime-list.php",
      search: "/api/search.php?keyword={query}",
      series: "/api/series.php?url={slug}",
      episode: "/api/series/episode/data.php?url={episode_slug}",
    },
  });
});

app.get("/status", (req, res) => {
  res.json({
    status: "running",
    target: TARGET_BASE,
    apiPath: API_PATH,
    port: PORT,
    uptime: process.uptime(),
  });
});

// ============================================
// CACHE UNTUK ENDPOINT YANG STATIS
// ============================================

const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 menit

function getCached(key) {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  return null;
}

function setCache(key, data) {
  cache.set(key, {
    data,
    timestamp: Date.now(),
  });
}

// ============================================
// PROXY MIDDLEWARE UTAMA
// ============================================

const proxyMiddleware = createProxyMiddleware({
  target: TARGET_BASE,
  changeOrigin: true,
  secure: true,
  pathRewrite: { "^/api": API_PATH },

  // Timeout settings
  proxyTimeout: 30000,
  timeout: 30000,

  on: {
    proxyReq: (proxyReq, req, res) => {
      // Headers yang lebih realistis
      proxyReq.setHeader(
        "User-Agent",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      );
      proxyReq.setHeader("Accept", "application/json, text/plain, */*");
      proxyReq.setHeader("Accept-Language", "id-ID,id;q=0.9,en;q=0.8");
      proxyReq.setHeader("Referer", "https://animekita.org/");
      proxyReq.setHeader("Origin", "https://animekita.org");
      proxyReq.removeHeader("origin");

      console.log(`  → ${proxyReq.method} ${proxyReq.path}`);
    },

    proxyRes: (proxyRes, req, res) => {
      console.log(`  ← ${proxyRes.statusCode} ${req.url}`);

      // Force CORS headers
      proxyRes.headers["access-control-allow-origin"] = "*";
      proxyRes.headers["access-control-allow-methods"] =
        "GET, POST, PUT, DELETE, OPTIONS";
      proxyRes.headers["access-control-allow-headers"] =
        "Content-Type, Authorization, X-Requested-With";
      proxyRes.headers["access-control-allow-credentials"] = "true";

      // Cache control untuk response yang sukses
      if (proxyRes.statusCode === 200) {
        proxyRes.headers["cache-control"] = "public, max-age=300";
      }
    },

    error: (err, req, res) => {
      console.error(`  ✗ ERROR: ${err.message}`);
      res.status(502).json({
        error: "Proxy Error",
        message: err.message,
        code: err.code,
      });
    },
  },
});

// ============================================
// ENDPOINT KHUSUS DENGAN CACHING
// ============================================

// Anime List (cached)
app.get("/api/anime-list.php", async (req, res) => {
  const cacheKey = "anime-list";
  const cached = getCached(cacheKey);

  if (cached) {
    console.log("  ✓ Return cached anime-list");
    return res.json(cached);
  }

  try {
    const fetch = (await import("node-fetch")).default;
    const response = await fetch(`${TARGET_BASE}${API_PATH}/anime-list.php`, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Referer: "https://animekita.org/",
      },
    });
    const data = await response.json();
    setCache(cacheKey, data);
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Ongoing dengan fix pagination (selalu return data yang sama)
app.get("/api/home/ongoing.php", async (req, res) => {
  try {
    const fetch = (await import("node-fetch")).default;
    const response = await fetch(
      `${TARGET_BASE}${API_PATH}/home/ongoing.php?page=1`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          Referer: "https://animekita.org/",
        },
      },
    );
    const data = await response.json();
    // Return data tanpa memperdulikan parameter page
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ============================================
// GLOBAL PROXY
// ============================================

app.use("/api", (req, res, next) => {
  // OPTIONS preflight
  if (req.method === "OPTIONS") {
    res.header("Access-Control-Allow-Origin", "*");
    res.header(
      "Access-Control-Allow-Methods",
      "GET, POST, PUT, DELETE, OPTIONS",
    );
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    return res.sendStatus(200);
  }
  next();
});

app.use("/api", proxyMiddleware);

// ============================================
// FALLBACK 404
// ============================================

app.use((req, res) => {
  res.status(404).json({
    error: "Not Found",
    path: req.url,
    message: `Endpoint tidak ditemukan. Gunakan /api/ untuk akses API.`,
  });
});

// ============================================
// START SERVER
// ============================================

app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║     🚀 PROXY SERVER ANIMELOVERS V3 BERJALAN                 ║
╠══════════════════════════════════════════════════════════════╣
║  Local:    http://localhost:${PORT}                          ║
║  Target:   ${TARGET_BASE}${API_PATH}                         ║
╠══════════════════════════════════════════════════════════════╣
║  📡 ENDPOINTS:                                              ║
║  GET  /ping                          - Test proxy           ║
║  GET  /api/anime-list.php            - Semua anime          ║
║  GET  /api/home/ongoing.php          - Ongoing (tanpa page) ║
║  GET  /api/search.php?keyword=       - Cari anime           ║
║  GET  /api/series.php?url=           - Detail series        ║
║  GET  /api/series/episode/data.php?url= - Link video       ║
╚══════════════════════════════════════════════════════════════╝
  `);
});
