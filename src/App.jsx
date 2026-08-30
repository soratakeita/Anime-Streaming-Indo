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

  // Efek untuk update SEO metadata secara dinamis
  useEffect(() => {
    let title = "AiaSubs — Streaming Anime Subtitle Indonesia Gratis Terlengkap";
    let desc = "Tonton streaming anime subtitle Indonesia gratis terlengkap di AiaSubs. Menyediakan update terjadwal anime ongoing, movie, dan genre populer.";

    if (view === "home") {
      title = "AiaSubs — Streaming Anime Subtitle Indonesia Gratis Terlengkap";
      desc = "Tonton streaming anime subtitle Indonesia gratis terlengkap di AiaSubs. Menyediakan update terjadwal anime ongoing, movie, dan genre populer.";
    } else if (view === "search" && query) {
      title = `Cari "${query}" — AiaSubs`;
      desc = `Hasil pencarian streaming anime subtitle Indonesia untuk "${query}" di AiaSubs.`;
    } else if (view === "detail" && selected) {
      title = `Nonton ${selected.title} Subtitle Indonesia — AiaSubs`;
      desc = `Nonton streaming anime ${selected.title} Subtitle Indonesia secara gratis dengan kualitas HD terlengkap hanya di AiaSubs.`;
    }

    document.title = title;
    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) metaDesc.setAttribute("content", desc);
    const ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle) ogTitle.setAttribute("content", title);
    const ogDesc = document.querySelector('meta[property="og:description"]');
    if (ogDesc) ogDesc.setAttribute("content", desc);
  }, [view, selected, query]);

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
          />
        )}
      </main>
    </div>
  );
}
