import { useState, useEffect, useRef } from "react";
import { api, toArray } from "../lib/api";
import { AnimeCard } from "./AnimeCard";
import { GridSkeleton } from "./Loaders";
import { cn } from "../lib/utils";

const TABS = [
  { id: "ongoing", label: "Sedang Tayang" },
  { id: "rekomendasi", label: "Rekomendasi" },
  { id: "list", label: "List" },
  { id: "jadwal", label: "Jadwal" },
  { id: "genre", label: "Genre" },
];

const POPULAR_GENRES = [
  { name: "Action", slug: "action" },
  { name: "Adventure", slug: "adventure" },
  { name: "Comedy", slug: "comedy" },
  { name: "Drama", slug: "drama" },
  { name: "Fantasy", slug: "fantasy" },
  { name: "Horror", slug: "horror" },
  { name: "Mystery", slug: "mystery" },
  { name: "Romance", slug: "romance" },
  { name: "Sci-Fi", slug: "sci-fi" },
  { name: "Slice of Life", slug: "slice of life" },
  { name: "Sports", slug: "sports" },
  { name: "Thriller", slug: "thriller" },
];

export function HomeView({ onSelect }) {
  const [tab, setTab] = useState("ongoing");
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(false);
  const [genreLoading, setGenreLoading] = useState(false);
  const [error, setError] = useState(null);
  const [ongoingPage, setOngoingPage] = useState(1);
  const [selectedGenre, setSelectedGenre] = useState("action");
  const [genrePage, setGenrePage] = useState(1);
  const [genreData, setGenreData] = useState([]);
  const [genreHasMore, setGenreHasMore] = useState(true);

  const cacheRef = useRef({});

  // ========== FETCH GENRE ==========
  useEffect(() => {
    if (tab !== "genre") return;

    const cacheKey = `${selectedGenre}_p${genrePage}`;
    if (cacheRef.current[cacheKey]) {
      const cached = cacheRef.current[cacheKey];
      if (genrePage === 1) {
        setGenreData(cached);
      } else {
        setGenreData((prev) => [...prev, ...cached]);
      }
      return;
    }

    let cancelled = false;
    setGenreLoading(true);
    setError(null);

    api
      .genreseries(selectedGenre, genrePage)
      .then((result) => {
        if (cancelled) return;
        const items = toArray(result).map((a) => ({
          ...a,
          judul: a.judul || a.anime_name,
          url: a.url || a.link,
          cover: a.cover || a.thumb || a.image || "",
          rating: a.rating || a.score || "",
        }));
        cacheRef.current[cacheKey] = items;
        if (genrePage === 1) {
          setGenreData(items);
        } else {
          setGenreData((prev) => [...prev, ...items]);
        }
        setGenreHasMore(items.length >= 25);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setGenreLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [tab, selectedGenre, genrePage]);

  // ========== FETCH TAB LAIN ==========
  useEffect(() => {
    if (tab === "genre") return;

    const cacheKey = tab === "ongoing" ? `ongoing_p${ongoingPage}` : tab;
    if (data[cacheKey]) return;

    const fetchers = {
      ongoing: () => api.ongoing(ongoingPage),
      rekomendasi: () => api.rekomendasi(),
      list: () => api.list(),
      jadwal: () => api.jadwal(),
    };

    const fetcher = fetchers[tab];
    if (!fetcher) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetcher()
      .then((d) => {
        if (cancelled) return;
        setData((prev) => {
          if (tab === "ongoing") {
            return {
              ...prev,
              [cacheKey]: d,
              ongoing:
                ongoingPage === 1
                  ? toArray(d)
                  : [...(prev.ongoing || []), ...toArray(d)],
            };
          }
          return { ...prev, [cacheKey]: d };
        });
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [tab, ongoingPage]);

  const handleGenreChange = (slug) => {
    if (slug === selectedGenre) return;
    setSelectedGenre(slug);
    setGenrePage(1);
    setGenreData([]);
    setGenreHasMore(true);
  };

  const current = tab === "ongoing" ? data.ongoing : data[tab];

  const renderContent = () => {
    if (tab !== "genre") {
      if (loading && !current) return <GridSkeleton />;
      if (error && !current)
        return (
          <p className="text-center py-16 text-zinc-500 text-sm">{error}</p>
        );
      if (!current) return null;
    }

    // ========== JADWAL ==========
    if (tab === "jadwal") {
      const raw = current.data || current;
      const days = Object.entries(raw).filter(([, v]) => Array.isArray(v));
      return (
        <div className="space-y-6">
          {days.map(([day, animes]) => (
            <div key={day}>
              <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-3">
                {day}
              </p>
              <div className="flex gap-3 overflow-x-auto pb-2">
                {animes.map((a, i) => (
                  <div
                    key={i}
                    className="min-w-[100px] w-[100px] flex-shrink-0"
                  >
                    <AnimeCard
                      anime={a}
                      onClick={() => a.url && onSelect(a.url, a.judul)}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
          {days.length === 0 && (
            <p className="text-center py-16 text-zinc-500 text-sm">
              Tidak ada jadwal.
            </p>
          )}
        </div>
      );
    }

    // ========== LIST ==========
    if (tab === "list") {
      const raw = current.data || current;
      const groups = Object.entries(raw).filter(([, v]) => Array.isArray(v));
      if (groups.length === 0) {
        return (
          <p className="text-center py-16 text-zinc-500 text-sm">
            Tidak ada data list.
          </p>
        );
      }
      return (
        <div className="space-y-8">
          {groups.map(([letter, animes]) => (
            <div key={letter}>
              <div className="sticky top-0 bg-background/90 backdrop-blur z-10 py-2 border-b border-zinc-800 mb-4">
                <span className="text-xl font-bold text-accent uppercase">
                  {letter}
                </span>
                <span className="text-xs text-zinc-500 ml-2">
                  ({animes.length} anime)
                </span>
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
                {animes.map((a, i) => (
                  <AnimeCard
                    key={a.id || i}
                    anime={a}
                    onClick={() => a.url && onSelect(a.url, a.judul)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      );
    }

    // ========== GENRE ==========
    if (tab === "genre") {
      return (
        <div>
          <div className="flex gap-2 overflow-x-auto pb-4 mb-6 sticky top-0 bg-background/95 backdrop-blur z-10 py-2">
            {POPULAR_GENRES.map((genre) => (
              <button
                key={genre.slug}
                onClick={() => handleGenreChange(genre.slug)}
                className={cn(
                  "px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all duration-200",
                  selectedGenre === genre.slug
                    ? "bg-gradient-to-r from-primary to-secondary text-white shadow-lg"
                    : "bg-white/10 hover:bg-white/20 text-zinc-400",
                )}
              >
                {genre.name}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 mb-4">
            <div className="w-1 h-6 bg-gradient-to-b from-primary to-secondary rounded-full" />
            <h2 className="text-xl font-bold">
              Anime {POPULAR_GENRES.find((g) => g.slug === selectedGenre)?.name}
            </h2>
            <span className="text-xs text-zinc-500">
              ({genreData.length} anime)
            </span>
          </div>

          {genreLoading && genreData.length === 0 ? (
            <GridSkeleton />
          ) : genreData.length > 0 ? (
            <>
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
                {genreData.map((anime, idx) => (
                  <AnimeCard
                    key={anime.id || idx}
                    anime={anime}
                    onClick={() =>
                      (anime.url || anime.link) &&
                      onSelect(
                        anime.url || anime.link,
                        anime.judul || anime.anime_name,
                      )
                    }
                  />
                ))}
              </div>
              {genreHasMore ? (
                <div className="flex justify-center pt-6">
                  <button
                    disabled={genreLoading}
                    onClick={() => setGenrePage((p) => p + 1)}
                    className="px-6 py-2 bg-surface-muted border border-surface-border rounded-lg text-sm font-medium text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 transition-colors disabled:opacity-50"
                  >
                    {genreLoading ? "Memuat..." : "Muat Lebih Banyak"}
                  </button>
                </div>
              ) : (
                <p className="text-center text-zinc-500 text-sm pt-6">
                  ~ Sudah mencapai akhir daftar ~
                </p>
              )}
            </>
          ) : (
            !genreLoading && (
              <p className="text-center py-16 text-zinc-500 text-sm">
                Tidak ada anime untuk genre ini.
              </p>
            )
          )}
        </div>
      );
    }

    // ========== ONGOING & REKOMENDASI ==========
    const items = tab === "ongoing" ? current : toArray(current);
    if (!items?.length) {
      return (
        <p className="text-center py-16 text-zinc-500 text-sm">
          Tidak ada data.
        </p>
      );
    }

    return (
      <div className="space-y-6">
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
          {items.map((a, i) => (
            <AnimeCard
              key={a.id || i}
              anime={a}
              onClick={() => a.url && onSelect(a.url, a.judul)}
            />
          ))}
        </div>
      </div>
    );
  };

  return (
    <div>
      <div className="flex gap-0 border-b border-surface-border mb-5 -mx-4 px-4 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => {
              setTab(t.id);
              if (t.id !== "ongoing") setOngoingPage(1);
            }}
            className={cn(
              "text-sm pb-3 px-4 border-b-2 transition-colors -mb-px whitespace-nowrap",
              tab === t.id
                ? "text-accent border-accent font-medium"
                : "text-zinc-500 border-transparent hover:text-zinc-300",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {renderContent()}
    </div>
  );
}
