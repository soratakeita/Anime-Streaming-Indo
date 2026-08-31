import { useState, useEffect, useCallback } from "react";
import { Search, X } from "lucide-react";
import { useDebounce } from "./hooks/useDebounce";
import { HomeView } from "./components/HomeView";
import { SearchView } from "./components/SearchView";
import { DetailView } from "./components/DetailView";

// helpers URL
function parseInitialRoute() {
  const path = window.location.pathname;
  const sp = new URLSearchParams(window.location.search);
  if (path.startsWith("/anime/")) {
    const raw = path.slice(7); // "/anime/".length = 7
    // raw may contain encoded slash, take whole
    const slug = decodeURIComponent(raw);
    const ep = sp.get("ep");
    return {
      view: "detail",
      selected: { url: slug, title: slug },
      query: sp.get("q") || "",
      homeTab: sp.get("tab") || "ongoing",
      homeGenre: sp.get("genre") || "action",
      initialEp: ep,
    };
  }
  if (path === "/search") {
    const q = sp.get("q") || "";
    return {
      view: q ? "search" : "home",
      selected: null,
      query: q,
      homeTab: "ongoing",
      homeGenre: "action",
      initialEp: null,
    };
  }
  // home with ?tab= & ?genre= & ?page=
  const tab = sp.get("tab") || "ongoing";
  const genre = sp.get("genre") || "action";
  return {
    view: "home",
    selected: null,
    query: "",
    homeTab: tab,
    homeGenre: genre,
    initialEp: null,
  };
}

export default function App() {
  const initial = parseInitialRoute();

  const [query, setQuery] = useState(initial.query);
  const [view, setView] = useState(initial.view);
  const [selected, setSelected] = useState(initial.selected);
  const [detailEp, setDetailEp] = useState(initial.initialEp);
  // meta detail dari DetailView (judul asli, sinopsis, cover) untuk SEO kaya
  const [animeMeta, setAnimeMeta] = useState(null);
  const [homeTab, setHomeTab] = useState(initial.homeTab);
  const [homeGenre, setHomeGenre] = useState(initial.homeGenre);
  // page params for home/search are read from URL on popstate
  const [homePage, setHomePage] = useState(() => {
    const sp = new URLSearchParams(window.location.search);
    return Math.max(1, parseInt(sp.get("page") || "1", 10));
  });
  const [searchPage, setSearchPage] = useState(() => {
    const sp = new URLSearchParams(window.location.search);
    return Math.max(1, parseInt(sp.get("page") || "1", 10));
  });

  const debouncedQuery = useDebounce(query, 400);

  // =========================================================
  // TRIK NUKLIR: SAKLAR PEMBANTAI VIDEO SETIAP PERGANTIAN VIEW
  // =========================================================
  useEffect(() => {
    const killAllMediaGlobally = () => {
      try {
        const videos = document.querySelectorAll("video");
        videos.forEach((vid) => {
          vid.pause();
          vid.src = "";
          vid.removeAttribute("src");
          vid.load();
        });
        const audios = document.querySelectorAll("audio");
        audios.forEach((aud) => {
          aud.pause();
          aud.src = "";
          aud.load();
        });
        const iframes = document.querySelectorAll("iframe");
        iframes.forEach((ifr) => {
          ifr.src = "about:blank";
          ifr.remove();
        });
      } catch (error) {
        console.log("Media cleanup error:", error);
      }
    };
    killAllMediaGlobally();
    return () => {
      killAllMediaGlobally();
    };
  }, [view]);

  // popstate handler untuk back/forward & refresh sudah di-handle initial parse
  useEffect(() => {
    const onPopState = () => {
      const r = parseInitialRoute();
      const sp = new URLSearchParams(window.location.search);
      setView(r.view);
      setSelected(r.selected);
      setQuery(r.query);
      setDetailEp(r.initialEp);
      setHomeTab(r.homeTab);
      setHomeGenre(r.homeGenre);
      setHomePage(Math.max(1, parseInt(sp.get("page") || "1", 10)));
      setSearchPage(Math.max(1, parseInt(sp.get("page") || "1", 10)));
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const pushUrl = useCallback((url, replace = false) => {
    if (replace) window.history.replaceState(null, "", url);
    else window.history.pushState(null, "", url);
  }, []);

  const handleSearch = (val) => {
    setQuery(val);
    if (!val.trim()) {
      // kembali ke home, reset URL
      pushUrl("/");
      setView("home");
    }
    // jika ada isi, biarkan debounced effect yang push ke /search
  };

  useEffect(() => {
    const q = debouncedQuery.trim();
    // cegah loop saat initial load sudah di /search dengan q yang sama
    const currentSp = new URLSearchParams(window.location.search);
    const currentPath = window.location.pathname;
    const currentQ = currentSp.get("q") || "";

    if (q) {
      if (currentPath === "/search" && currentQ === q) {
        // sudah di URL yang benar, cukup pastikan view search
        if (view !== "search") setView("search");
        return;
      }
      const url = `/search?q=${encodeURIComponent(q)}&page=1`;
      pushUrl(url);
      setView("search");
      setSearchPage(1);
    } else {
      // query kosong tapi kita lagi di /search -> balik home
      if (currentPath === "/search") {
        pushUrl("/");
        setView("home");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery]);

  const handleSelect = (url, title) => {
    const slug = encodeURIComponent(url);
    const path = `/anime/${slug}`;
    pushUrl(path);
    setSelected({ url, title });
    setDetailEp(null);
    setView("detail");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleDetailEpChange = useCallback((epUrl) => {
    if (!selected) return;
    const base = `/anime/${encodeURIComponent(selected.url)}`;
    const url = epUrl ? `${base}?ep=${encodeURIComponent(epUrl)}` : base;
    // replace agar tidak spam history tiap ganti episode
    pushUrl(url, true);
    setDetailEp(epUrl);
  }, [selected, pushUrl]);

  const handleBack = () => {
    // jika ada history, pakai back agar animasi natural
    // fallback ke home/search sesuai query
    if (window.history.length > 1) {
      window.history.back();
    } else {
      if (query.trim()) {
        const url = `/search?q=${encodeURIComponent(query)}&page=${searchPage}`;
        pushUrl(url);
        setView("search");
      } else {
        pushUrl("/");
        setView("home");
      }
    }
  };

  const handleLogoClick = () => {
    setQuery("");
    pushUrl("/");
    setView("home");
    setHomeTab("ongoing");
    setHomePage(1);
  };

  const handleHomeTabChange = useCallback((tab, genre, page) => {
    setHomeTab(tab);
    if (genre) setHomeGenre(genre);
    if (page) setHomePage(page);
    // update URL tanpa reload
    const sp = new URLSearchParams();
    if (tab && tab !== "ongoing") sp.set("tab", tab);
    if (tab === "genre" && genre) sp.set("genre", genre);
    if (page && page > 1) sp.set("page", String(page));
    // ongoing page >1 juga perlu disimpan
    if (tab === "ongoing" && page && page > 1) sp.set("page", String(page));
    const qs = sp.toString();
    const url = qs ? `/?${qs}` : "/";
    // replace untuk tab switch biar tidak numpuk history terlalu banyak
    pushUrl(url, true);
  }, [pushUrl]);

  const handleSearchPageChange = useCallback((page) => {
    setSearchPage(page);
    const q = query || new URLSearchParams(window.location.search).get("q") || "";
    const url = `/search?q=${encodeURIComponent(q)}&page=${page}`;
    pushUrl(url, true);
  }, [query, pushUrl]);

  // bersihkan animeMeta saat ganti anime
  useEffect(() => { setAnimeMeta(null); }, [selected?.url]);

  // Efek untuk update SEO metadata secara dinamis (title, desc, canonical, OG, JSON-LD)
  useEffect(() => {
    const SITE = window.location.origin;
    let title = "AiaSubs — Streaming Anime Subtitle Indonesia Gratis Terlengkap";
    let desc = "Tonton streaming anime subtitle Indonesia gratis terlengkap di AiaSubs. Menyediakan update terjadwal anime ongoing, movie, dan genre populer.";
    let canonical = SITE + "/";
    let ogType = "website";
    let ogImage = SITE + "/favicon.svg";
    let allowIndex = true;

    if (view === "home") {
      title = "AiaSubs — Streaming Anime Subtitle Indonesia Gratis Terlengkap";
      desc = "Tonton streaming anime subtitle Indonesia gratis terlengkap di AiaSubs. Menyediakan update terjadwal anime ongoing, movie, dan genre populer.";
      const sp = new URLSearchParams(window.location.search);
      const qs = sp.toString();
      canonical = qs ? `${SITE}/?${qs}` : `${SITE}/`;
    } else if (view === "search" && query) {
      title = `Cari "${query}" — AiaSubs`;
      desc = `Hasil pencarian streaming anime subtitle Indonesia untuk "${query}" di AiaSubs.`;
      canonical = `${SITE}/search?q=${encodeURIComponent(query)}`;
      allowIndex = true;
    } else if (view === "detail" && selected) {
      const realTitle = animeMeta?.judul || selected.title;
      const sinopsis = (animeMeta?.sinopsis || animeMeta?.deskripsi || "").replace(/\s+/g, " ").trim().slice(0, 155);
      title = `Nonton ${realTitle} Subtitle Indonesia — AiaSubs`;
      desc = sinopsis || `Nonton streaming anime ${realTitle} Subtitle Indonesia secara gratis dengan kualitas HD terlengkap hanya di AiaSubs.`;
      if (animeMeta?.genre?.length) desc += ` Genre: ${animeMeta.genre.slice(0,3).join(", ")}.`;
      canonical = `${SITE}/anime/${encodeURIComponent(selected.url)}`;
      if (detailEp) canonical += `?ep=${encodeURIComponent(detailEp)}`;
      ogType = "video.other";
      if (animeMeta?.cover) ogImage = animeMeta.cover;
    }

    document.title = title;
    const setMeta = (sel, val) => {
      const el = document.querySelector(sel);
      if (el) el.setAttribute("content", val);
    };
    const ensureMeta = (prop, attrVal, content) => {
      let el = document.querySelector(`meta[${prop}="${attrVal}"]`);
      if (!el) { el = document.createElement("meta"); el.setAttribute(prop, attrVal); document.head.appendChild(el); }
      el.setAttribute("content", content);
    };
    setMeta('meta[name="description"]', desc);
    setMeta('meta[property="og:title"]', title);
    setMeta('meta[property="og:description"]', desc);
    setMeta('meta[property="og:url"]', canonical);
    setMeta('meta[property="og:type"]', ogType);
    setMeta('meta[name="twitter:title"]', title);
    setMeta('meta[name="twitter:description"]', desc);
    ensureMeta("property", "og:image", ogImage);
    ensureMeta("name", "twitter:image", ogImage);

    // canonical
    let linkCanon = document.querySelector('link[rel="canonical"]');
    if (!linkCanon) {
      linkCanon = document.createElement("link");
      linkCanon.setAttribute("rel", "canonical");
      document.head.appendChild(linkCanon);
    }
    linkCanon.setAttribute("href", canonical);

    const metaRobots = document.querySelector('meta[name="robots"]');
    if (metaRobots) metaRobots.setAttribute("content", allowIndex ? "index, follow, max-image-preview:large" : "noindex, follow");

    // JSON-LD dinamis per view
    const oldLd = document.getElementById("ld-json-dynamic");
    if (oldLd) oldLd.remove();
    const oldBc = document.getElementById("ld-json-breadcrumb");
    if (oldBc) oldBc.remove();
    const script = document.createElement("script");
    script.type = "application/ld+json";
    script.id = "ld-json-dynamic";
    let ld = null;
    if (view === "detail" && selected) {
      const realTitle = animeMeta?.judul || selected.title;
      ld = {
        "@context": "https://schema.org",
        "@type": "TVSeries",
        name: realTitle,
        url: canonical,
        description: desc,
        inLanguage: "id-ID",
        genre: animeMeta?.genre || "Anime",
        image: ogImage,
        aggregateRating: animeMeta?.rating ? { "@type": "AggregateRating", ratingValue: String(animeMeta.rating).replace(/[^0-9.]/g,""), bestRating: "10" } : undefined,
      };
      // breadcrumb
      const bc = document.createElement("script");
      bc.type = "application/ld+json";
      bc.id = "ld-json-breadcrumb";
      bc.textContent = JSON.stringify({
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: SITE + "/" },
          { "@type": "ListItem", position: 2, name: realTitle, item: SITE + "/anime/" + encodeURIComponent(selected.url) },
        ],
      });
      document.head.appendChild(bc);
    } else if (view === "search" && query) {
      ld = {
        "@context": "https://schema.org",
        "@type": "SearchResultsPage",
        name: title,
        description: desc,
        url: canonical,
      };
    } else {
      ld = {
        "@context": "https://schema.org",
        "@type": "WebSite",
        name: "AiaSubs",
        url: SITE + "/",
        potentialAction: {
          "@type": "SearchAction",
          target: `${SITE}/search?q={search_term_string}`,
          "query-input": "required name=search_term_string",
        },
      };
    }
    // hapus undefined
    script.textContent = JSON.stringify(ld, (k,v)=> v===undefined?undefined:v);
    document.head.appendChild(script);
  }, [view, selected, query, detailEp, animeMeta]);

  return (
    <div className="min-h-screen bg-surface text-zinc-200">
      <header className="sticky top-0 z-10 bg-[#0f0f0f]/90 backdrop-blur-sm border-b border-surface-border">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-4">
          <button
            onClick={handleLogoClick}
            className="text-base font-semibold tracking-tight flex-shrink-0 hover:opacity-80 transition-opacity"
          >
            Aia<span className="text-accent">Subs</span>
          </button>
          
          <div className="flex-1 relative">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none"
            />
            <input
              type="text"
              value={query}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="Cari judul anime..."
              className="w-full bg-surface-muted border border-surface-border rounded-lg pl-9 pr-9 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500 transition-colors"
            />
            {query && (
              <button
                onClick={() => handleSearch("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                <X size={13} />
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-5">
        {view === "home" && (
          <HomeView
            onSelect={handleSelect}
            initialTab={homeTab}
            initialGenre={homeGenre}
            initialPage={homePage}
            onTabChange={handleHomeTabChange}
          />
        )}

        {view === "search" && (
          <SearchView
            keyword={query || debouncedQuery}
            onSelect={handleSelect}
            initialPage={searchPage}
            onPageChange={handleSearchPageChange}
          />
        )}

        {view === "detail" && selected && (
          <DetailView
            animeUrl={selected.url}
            onBack={handleBack}
            initialEp={detailEp}
            onEpChange={handleDetailEpChange}
            onAnimeMeta={setAnimeMeta}
          />
        )}
      </main>
    </div>
  );
}
