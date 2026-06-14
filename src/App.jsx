import { useState, useEffect } from "react";
import { Search, X } from "lucide-react";
import { useDebounce } from "./hooks/useDebounce";
import { HomeView } from "./components/HomeView";
import { SearchView } from "./components/SearchView";
import { DetailView } from "./components/DetailView";

export default function App() {
  const [query, setQuery] = useState("");
  const [view, setView] = useState("home");
  const [selected, setSelected] = useState(null);
  const debouncedQuery = useDebounce(query, 400);

  // =========================================================
  // TRIK NUKLIR: SAKLAR PEMBANTAI VIDEO SETIAP PERGANTIAN VIEW
  // =========================================================
  useEffect(() => {
    // Fungsi ini akan dipanggil SETIAP KALI halaman (view) berubah
    const killAllMediaGlobally = () => {
      try {
        // 1. Matikan semua tag <video> asli HTML5 di DOM
        const videos = document.querySelectorAll("video");
        videos.forEach((vid) => {
          vid.pause();
          vid.src = "";
          vid.removeAttribute("src");
          vid.load();
        });

        // 2. Matikan semua tag <audio> (jika ada)
        const audios = document.querySelectorAll("audio");
        audios.forEach((aud) => {
          aud.pause();
          aud.src = "";
          aud.load();
        });

        // 3. Hancurkan semua iframe (jika API anime pake sistem embed player/bukan mp4 langsung)
        const iframes = document.querySelectorAll("iframe");
        iframes.forEach((ifr) => {
          ifr.src = "about:blank"; // Paksa kosongkan isi iframe biar streamingnya mati
          ifr.remove(); // Hapus iframe-nya dari halaman
        });
      } catch (error) {
        console.log("Media cleanup error:", error);
      }
    };

    // Jalankan pembantaian media setiap kali status 'view' berubah (Home / Search / Detail)
    killAllMediaGlobally();

    return () => {
      killAllMediaGlobally();
    };
  }, [view]); // Ikut berubah setiap kali view berubah

  const handleSearch = (val) => {
    setQuery(val);
    if (!val.trim()) {
      setView("home");
    }
  };

  useEffect(() => {
    if (debouncedQuery.trim()) {
      setView("search");
    }
  }, [debouncedQuery]);

  const handleSelect = (url, title) => {
    setSelected({ url, title });
    setView("detail");
  };

  const handleBack = () => {
    if (query.trim()) setView("search");
    else setView("home");
  };

  return (
    <div className="min-h-screen bg-surface text-zinc-200">
      <header className="sticky top-0 z-10 bg-[#0f0f0f]/90 backdrop-blur-sm border-b border-surface-border">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-4">
          <button
            onClick={() => {
              setQuery("");
              setView("home");
            }}
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
        {view === "home" && <HomeView onSelect={handleSelect} />}

        {view === "search" && debouncedQuery && (
          <SearchView keyword={debouncedQuery} onSelect={handleSelect} />
        )}

        {view === "detail" && selected && (
          <DetailView animeUrl={selected.url} onBack={handleBack} />
        )}
      </main>
    </div>
  );
}
