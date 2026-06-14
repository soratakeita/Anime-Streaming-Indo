import { useState, useRef, useEffect } from "react";
import { Tv } from "lucide-react";
import { cn } from "../lib/utils";
import { proxyImage } from "../lib/api";

export function AnimeCard({ anime, onClick, className }) {
  const [imgError, setImgError] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [inView, setInView] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const showFallback = !anime.cover || imgError;

  return (
    <div
      ref={ref}
      onClick={onClick}
      className={cn(
        "group cursor-pointer rounded-lg overflow-hidden bg-surface-card border border-surface-border hover:border-accent transition-colors duration-150",
        className,
      )}
    >
      <div className="relative aspect-[3/4] bg-surface-muted overflow-hidden">
        {!showFallback && inView && (
          <img
            src={proxyImage(anime.cover)}
            alt={anime.judul}
            decoding="async"
            className={cn(
              "w-full h-full object-cover group-hover:scale-105 transition-transform duration-300",
              imgLoaded ? "opacity-100" : "opacity-0",
            )}
            onLoad={() => setImgLoaded(true)}
            onError={() => setImgError(true)}
          />
        )}
        {(showFallback || !inView || !imgLoaded) && (
          <div className="absolute inset-0 flex items-center justify-center text-zinc-600 bg-surface-muted">
            {showFallback ? (
              <Tv size={28} />
            ) : (
              <div className="w-6 h-6 rounded-full border-2 border-zinc-700 border-t-zinc-400 animate-spin" />
            )}
          </div>
        )}
        {anime.type && (
          <span className="absolute top-2 right-2 bg-accent text-white text-[10px] font-medium px-2 py-0.5 rounded">
            {anime.type}
          </span>
        )}
      </div>
      <div className="p-2">
        <p className="text-xs font-medium text-zinc-200 leading-tight line-clamp-2">
          {anime.judul}
        </p>
        {anime.rating && (
          <p className="text-[11px] text-zinc-500 mt-1">⭐ {anime.rating}</p>
        )}
      </div>
    </div>
  );
}
