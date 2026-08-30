const BASE = "/api";

// Retry config untuk handle 403 intermittent (WAF / rate-limit)
const RETRY_STATUSES = new Set([403, 429, 502, 503, 504]);
const MAX_RETRIES = 2;
const BASE_DELAY_MS = 700;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function apiFetch(path, options, attempt = 0) {
  const res = await fetch(BASE + path, options);
  const text = await res.text().catch(() => "");

  const isHtml403 = text.trim().startsWith("<!DOCTYPE") && text.includes("403 Forbidden");

  if (!res.ok || isHtml403) {
    const status = isHtml403 ? 403 : res.status;
    // Retry untuk status transient (403 kadang WAF, 429 rate-limit, 5xx)
    if (RETRY_STATUSES.has(status) && attempt < MAX_RETRIES) {
      const delay = BASE_DELAY_MS * (attempt + 1) + Math.random() * 400;
      console.warn(`[api] ${path} → ${status}${isHtml403 ? " (HTML)" : ""}, retry ${attempt + 1}/${MAX_RETRIES} after ${Math.round(delay)}ms`);
      await sleep(delay);
      return apiFetch(path, options, attempt + 1);
    }
    if (isHtml403) {
      throw new Error(`HTTP 403 - Server animekita memblokir request. Coba refresh 3 detik lagi.`);
    }
    // coba parse JSON error dari proxy (sudah diubah jadi JSON)
    try {
      const j = JSON.parse(text);
      if (j.error) throw new Error(j.error);
    } catch (e) {
      if (e.message && !e.message.startsWith("HTTP")) throw e;
    }
    const snippet = text ? ` - ${text.slice(0, 300).replace(/<[^>]*>/g, "").trim()}` : "";
    throw new Error(`HTTP ${status}${snippet}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function toArray(d) {
  if (!d) return [];
  if (Array.isArray(d)) return d;
  if (Array.isArray(d.data)) return d.data;
  if (Array.isArray(d.anime)) return d.anime;
  if (Array.isArray(d.result)) return d.result;

  const alphabetKeys = Object.keys(d).filter((k) => /^[#A-Z]$/.test(k));
  if (alphabetKeys.length > 0) {
    return alphabetKeys.flatMap((k) => (Array.isArray(d[k]) ? d[k] : []));
  }

  for (const key of Object.keys(d)) {
    if (Array.isArray(d[key])) return d[key];
  }

  return [];
}

export function toSeries(d) {
  if (!d) return null;
  if (Array.isArray(d) && d.length > 0) return d[0];
  if (d.data && !Array.isArray(d.data)) return d.data;
  if (Array.isArray(d.data) && d.data.length > 0) return d.data[0];
  if (d.chapter || d.judul) return d;
  return d;
}

export function toChapters(series) {
  if (!series) return [];
  return (
    series.chapter ??
    series.episode ??
    series.episodes ??
    series.data?.chapter ??
    []
  );
}

export function toStreams(d) {
  if (!d) return { streams: {}, resos: [], sizes: {} };

  const item = Array.isArray(d.data)
    ? d.data[0]
    : Array.isArray(d)
      ? d[0]
      : (d.data ?? d);

  const streams = item?.streams ?? {};
  return {
    streams,
    resos: item?.reso ?? Object.keys(streams),
    sizes: item?.resoSize ?? {},
  };
}

export function getBestVideoUrl(streams) {
  const PRIORITY_RESOS = ["720p", "480p", "360p"];
  const MAIN_PROVIDER = 871;

  for (const res of PRIORITY_RESOS) {
    if (!streams[res]) continue;
    const main = streams[res].find((s) => s.provide === MAIN_PROVIDER);
    const url = main?.link ?? streams[res][0]?.link;
    if (url) return url;
  }

  for (const links of Object.values(streams)) {
    if (links[0]?.link) return links[0].link;
  }

  return null;
}

export function getAllVideoUrls(streams) {
  return Object.entries(streams).flatMap(([resolution, links]) =>
    links.map((link) => ({
      resolution,
      url: link.link,
      provider: link.provide,
      size_kb: link.size_kb,
    })),
  );
}

export function proxyImage(url) {
  if (!url) return "";
  return `/img-proxy?url=${encodeURIComponent(url)}`;
}

export const api = {
  search: (kw, p = 1) =>
    apiFetch(`/search.php?keyword=${encodeURIComponent(kw)}&page=${p}`),

  ongoing: (p = 1) => apiFetch(`/home/ongoing.php?page=${p}`),

  rekomendasi: () => apiFetch("/rekomendasi.php"),

  movie: () => apiFetch("/movie.php"),

  list: () => apiFetch("/anime-list.php"),

  genreseries: (genre, page = 1) =>
    apiFetch(`/genreseries.php?url=${encodeURIComponent(genre)}&page=${page}`),

  jadwal: () => apiFetch("/jadwal.php"),

  series: (url) => apiFetch(`/series.php?url=${encodeURIComponent(url)}`),

  seriesSimple: (id) => apiFetch(`/seriesSimple.php?id=${id}`),

  episode: (url) =>
    apiFetch(`/series/episode/data.php?url=${encodeURIComponent(url)}`),

  episodeById: (id) => apiFetch(`/series/episode/data.php?id=${id}`),

  likes: (id) =>
    apiFetch(`/series/episode/likes/getLikes.php?episode_id=${id}`),

  komentar: () => apiFetch("/model/komentar.php"),

  checkTotalKomentar: (postId) =>
    apiFetch(`/series/episode/komentar/checkTotal.php?post_id=${postId}`),

  userDetails: () => apiFetch("/users/details.php"),

  userDetailsComplex: (type = "overview") =>
    apiFetch(`/users/detailsComplex.php?get=${type}`),

  login: (username, password) =>
    apiFetch("/model/login.php", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ username, password }).toString(),
    }),
};

export default api;
