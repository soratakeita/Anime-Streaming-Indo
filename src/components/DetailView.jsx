import { useState, useEffect } from "react";
import { ArrowLeft, Eye, Play, Tv } from "lucide-react";
import { api, toSeries, toChapters, toStreams } from "../lib/api";
import { VideoPlayer } from "./VideoPlayer";
import { Loading } from "./Loaders";

export function DetailView({ animeUrl, onBack }) {
  const [anime, setAnime] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeEp, setActiveEp] = useState(null);
  const [streamData, setStreamData] = useState(null);
  const [epLoading, setEpLoading] = useState(false);
  const [likes, setLikes] = useState(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setActiveEp(null);
    setStreamData(null);
    api.series(animeUrl)
      .then((d) => setAnime(toSeries(d)))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [animeUrl]);

  const loadEp = async (ep) => {
    // ep.url adalah slug seperti "al-150437-12"
    if (!ep.url) return;
    setActiveEp(ep.url);
    setEpLoading(true);
    setStreamData(null);
    setLikes(null);
    try {
      const [vd, ld] = await Promise.all([
        api.episode(ep.url),
        api.likes(ep.id).catch(() => null),
      ]);
      const parsed = toStreams(vd);
      setStreamData({ ...parsed, epNum: ep.ch });
      if (ld?.data?.[0]) setLikes(ld.data[0]);
    } catch (e) {
      console.error("[EPISODE ERROR]", e);
    } finally {
      setEpLoading(false);
    }
    setTimeout(() => {
      document.getElementById("player-anchor")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 100);
  };

  if (loading) return <Loading label="Memuat detail..." />;
  if (error) return <div className="text-center py-16 text-zinc-500 text-sm">{error}</div>;
  if (!anime) return null;

  const chapters = toChapters(anime).sort((a, b) => parseInt(a.ch) - parseInt(b.ch));

  return (
    <div>
      <button onClick={onBack} className="flex items-center gap-2 text-sm text-zinc-400 hover:text-zinc-200 mb-5 transition-colors">
        <ArrowLeft size={15} /> Kembali
      </button>

      <div className="flex gap-4 mb-6">
        <div className="w-28 min-w-[7rem] aspect-[3/4] rounded-lg bg-surface-muted overflow-hidden flex items-center justify-center text-zinc-600 border border-surface-border">
          {anime.cover
            ? <img src={anime.cover} alt={anime.judul} className="w-full h-full object-cover" />
            : <Tv size={28} />}
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-semibold text-zinc-100 leading-tight mb-2">{anime.judul || "—"}</h2>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {anime.type   && <Badge>{anime.type}</Badge>}
            {anime.status && <Badge>{anime.status}</Badge>}
            {anime.rating && <Badge>⭐ {anime.rating}</Badge>}
            {Array.isArray(anime.genre) && anime.genre.slice(0, 4).map(g => <Badge key={g}>{g}</Badge>)}
          </div>
          {(anime.sinopsis || anime.deskripsi) && (
            <p className="text-xs text-zinc-400 leading-relaxed line-clamp-4">
              {anime.sinopsis || anime.deskripsi}
            </p>
          )}
        </div>
      </div>

      <div id="player-anchor" />
      {epLoading && <Loading label="Memuat video..." />}
      {streamData && !epLoading && (
        <VideoPlayer
          streams={streamData.streams}
          resos={streamData.resos}
          sizes={streamData.sizes}
          title={anime.judul}
          epNum={streamData.epNum}
          likes={likes}
        />
      )}

      <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-3">
        Episode ({chapters.length})
      </p>

      {chapters.length === 0 ? (
        <p className="text-center py-8 text-zinc-600 text-sm">Belum ada episode.</p>
      ) : (
        <div className="flex flex-col gap-1.5 max-h-[360px] overflow-y-auto pr-1">
          {chapters.map((ep) => (
            <button
              key={ep.url || ep.id}
              onClick={() => loadEp(ep)}
              disabled={!ep.url}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-colors disabled:opacity-40 ${
                activeEp === ep.url
                  ? "bg-surface-muted border-accent"
                  : "bg-surface-card border-surface-border hover:border-zinc-600"
              }`}
            >
              <span className="text-accent font-medium text-sm min-w-[3rem]">Ep {ep.ch}</span>
              <span className="flex-1 text-sm text-zinc-300">Episode {ep.ch}</span>
              {ep.date && (
                <span className="text-[11px] text-zinc-500 hidden sm:block">{ep.date}</span>
              )}
              {ep.views != null && (
                <span className="flex items-center gap-1 text-[11px] text-zinc-500">
                  <Eye size={11} /> {Number(ep.views).toLocaleString()}
                </span>
              )}
              <Play size={13} className="text-accent opacity-60 flex-shrink-0" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Badge({ children }) {
  return (
    <span className="text-[11px] px-2 py-0.5 rounded bg-surface-muted border border-surface-border text-zinc-400">
      {children}
    </span>
  );
}
