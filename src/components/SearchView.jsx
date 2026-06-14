import { useState, useEffect } from "react";
import { api, toArray } from "../lib/api";
import { AnimeCard } from "./AnimeCard";
import { GridSkeleton } from "./Loaders";

export function SearchView({ keyword, onSelect }) {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [searched, setSearched] = useState("");

  // State untuk pagination
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);

  useEffect(() => {
    if (!keyword.trim()) return;
    setLoading(true);
    setError(null);

    // Kirim keyword dan halaman aktif ke API
    api
      .search(keyword, page)
      .then((d) => {
        // Ekstraksi data berdasarkan format JSON: d.data[0].result
        if (d && d.data && d.data[0]) {
          const rootData = d.data[0];
          setResults(toArray(rootData.result));
          setHasMore(rootData.pagination?.has_next || false);
        } else {
          setResults([]);
          setHasMore(false);
        }
        setSearched(keyword);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [keyword, page]); // Efek jalan ulang jika kata kunci atau halaman berubah

  // Reset halaman ke 1 jika pengguna mengetik kata kunci baru
  useEffect(() => {
    setPage(1);
  }, [keyword]);

  if (loading)
    return (
      <div>
        <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-4">
          Mencari "{keyword}"...
        </p>
        <GridSkeleton count={8} />
      </div>
    );

  if (error)
    return <p className="text-center py-16 text-zinc-500 text-sm">{error}</p>;

  return (
    <div>
      <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-4">
        Hasil untuk "{searched}" (Halaman {page})
      </p>

      {results.length === 0 ? (
        <div className="text-center py-16 text-zinc-500 text-sm">
          <p className="text-3xl mb-3">🔍</p>
          <p>Tidak ada anime untuk "{searched}"</p>
        </div>
      ) : (
        <>
          {/* Grid List Anime */}
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
            {results.map((a, i) => (
              <AnimeCard
                key={a.id || i}
                anime={a} // <-- Diubah dari results={a} menjadi anime={a} agar cocok
                onClick={() => a.url && onSelect(a.url, a.judul)}
              />
            ))}
          </div>

          {/* Navigasi Pagination Berada Di Sini */}
          {results.length > 0 && (
            <div className="flex justify-center items-center gap-4 mt-8">
              <button
                disabled={page === 1}
                onClick={() => setPage((prev) => prev - 1)}
                className="px-3 py-1.5 text-xs font-medium bg-zinc-800 text-zinc-200 rounded disabled:opacity-50 hover:bg-zinc-700 transition-colors"
              >
                Sebelumnya
              </button>

              <span className="text-xs text-zinc-400">Halaman {page}</span>

              <button
                disabled={!hasMore}
                onClick={() => setPage((prev) => prev + 1)}
                className="px-3 py-1.5 text-xs font-medium bg-zinc-800 text-zinc-200 rounded disabled:opacity-50 hover:bg-zinc-700 transition-colors"
              >
                Berikutnya
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
