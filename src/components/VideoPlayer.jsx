import { useState, useRef, useEffect, useMemo } from "react";
import { Download, ThumbsUp, ThumbsDown, Play, Server } from "lucide-react";
import { cn } from "../lib/utils";

const extractPixeldrainId = (url) => {
  if (!url) return "";
  const match = url.match(/[\/=]([a-zA-Z0-9_-]{8,})(?:[\/\?]|$)/);
  return match?.[1] || "";
};

// Nama provider berdasarkan kode
const getProviderName = (provide) => {
  switch (provide) {
    case 15:
      return "Server 1 (sjkt)";
    case 99:
      return "Pixeldrain";
    case 871:
      return "Server Utama (storage)";
    default:
      return `Server ${provide}`;
  }
};

// Urutan prioritas server (yang paling cepat/andal diutamakan)
const getServerPriority = (provide) => {
  switch (provide) {
    case 871:
      return 1; // storage.animekita.org - paling cepat
    case 15:
      return 2; // sjkt.animekita.org
    case 99:
      return 3; // pixeldrain (backup)
    default:
      return 99;
  }
};

export function VideoPlayer({ streams, resos, sizes, title, epNum, likes }) {
  const [selectedReso, setSelectedReso] = useState(
    resos.includes("720p") ? "720p" : resos[0] || "",
  );
  const [selectedServer, setSelectedServer] = useState(null);
  const [isAlive, setIsAlive] = useState(true);
  const videoRef = useRef(null);

  // Dapatkan semua link untuk resolusi yang dipilih, urutkan berdasarkan prioritas server
  const availableServers = useMemo(() => {
    if (!streams[selectedReso]) return [];

    const servers = streams[selectedReso].map((server) => ({
      provide: server.provide,
      link: server.link,
      name: getProviderName(server.provide),
      priority: getServerPriority(server.provide),
      isPixeldrain: server.link.includes("pixeldrain.com"),
      pixeldrainId: extractPixeldrainId(server.link),
    }));

    // Urutkan berdasarkan prioritas
    servers.sort((a, b) => a.priority - b.priority);
    return servers;
  }, [streams, selectedReso]);

  // Auto-select server terbaik saat resolusi berubah
  useEffect(() => {
    if (availableServers.length > 0) {
      setSelectedServer(availableServers[0].provide);
    }
  }, [availableServers]);

  const currentServer = availableServers.find(
    (s) => s.provide === selectedServer,
  );
  const rawUrl = currentServer?.link || "";
  const isPixeldrain = currentServer?.isPixeldrain || false;
  const pixeldrainId = currentServer?.pixeldrainId || "";

  // Reset video player saat server berubah
  useEffect(() => {
    setIsAlive(true);
    const vid = videoRef.current;
    if (vid && rawUrl && !isPixeldrain) {
      vid.src = rawUrl;
      vid.load();
      vid.play().catch(() => {});
    }
  }, [rawUrl, isPixeldrain]);

  // Force kill saat navigasi
  useEffect(() => {
    const forceKill = () => {
      setIsAlive(false);
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.src = "";
        videoRef.current.load();
      }
    };
    window.addEventListener("popstate", forceKill);
    return () => {
      window.removeEventListener("popstate", forceKill);
      forceKill();
    };
  }, []);

  const handleResoChange = (reso) => {
    setSelectedReso(reso);
    // Server akan auto-select berdasarkan prioritas via useEffect
  };

  const handleServerChange = (provide) => {
    setSelectedServer(provide);
  };

  if (!isAlive) return null;

  return (
    <div className="bg-surface-card rounded-xl overflow-hidden border border-surface-border mb-4">
      {/* Video Player Area */}
      <div className="relative bg-black aspect-video flex items-center justify-center">
        {rawUrl ? (
          isPixeldrain ? (
            pixeldrainId ? (
              <iframe
                src={`https://pixeldrain.com/u/${pixeldrainId}`}
                className="w-full h-full border-0"
                allowFullScreen
                allow="autoplay; fullscreen"
                title={`${title} — Ep ${epNum}`}
              />
            ) : (
              <div className="flex flex-col items-center gap-3 text-zinc-600">
                <Play size={40} />
                <p className="text-sm">Gagal memuat video dari Pixeldrain</p>
              </div>
            )
          ) : (
            <video
              ref={videoRef}
              key={`${selectedReso}-${selectedServer}`}
              controls
              autoPlay
              className="w-full h-full"
              preload="metadata"
            >
              <source src={rawUrl} type="video/mp4" />
            </video>
          )
        ) : (
          <div className="flex flex-col items-center gap-3 text-zinc-600">
            <Play size={40} />
            <p className="text-sm">Pilih resolusi untuk mulai</p>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="px-4 py-3 space-y-3">
        {/* Title & Episode */}
        <p className="text-sm font-medium text-zinc-200 truncate">
          {title} — Ep {epNum}
        </p>

        {/* Resolution Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-zinc-500">Resolusi:</span>
          <div className="flex flex-wrap gap-1.5">
            {resos.map((r) => (
              <button
                key={r}
                onClick={() => handleResoChange(r)}
                className={cn(
                  "text-xs px-3 py-1 rounded border transition-colors",
                  r === selectedReso
                    ? "bg-accent border-accent text-white"
                    : "border-surface-border text-zinc-400 hover:border-zinc-500",
                )}
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        {/* Server Selection (hanya tampil jika ada lebih dari 1 server untuk resolusi ini) */}
        {availableServers.length > 1 && (
          <div className="flex flex-wrap items-center gap-2">
            <Server size={14} className="text-zinc-500" />
            <span className="text-xs text-zinc-500">Server:</span>
            <div className="flex flex-wrap gap-1.5">
              {availableServers.map((server) => (
                <button
                  key={server.provide}
                  onClick={() => handleServerChange(server.provide)}
                  className={cn(
                    "text-xs px-3 py-1 rounded border transition-colors",
                    selectedServer === server.provide
                      ? "bg-accent border-accent text-white"
                      : "border-surface-border text-zinc-400 hover:border-zinc-500",
                  )}
                >
                  {server.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Download Button */}
        {rawUrl && !isPixeldrain && (
          <div className="flex justify-end">
            <a
              href={rawUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 text-xs text-zinc-400 border border-surface-border px-3 py-1 rounded hover:border-zinc-500 transition-colors"
            >
              <Download size={13} />
              {sizes[selectedReso] || "Unduh"}
            </a>
          </div>
        )}
      </div>

      {/* Likes Section */}
      {likes && (
        <div className="px-4 pb-3 flex items-center gap-3 border-t border-surface-border pt-3">
          <button className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-accent transition-colors">
            <ThumbsUp size={13} />
            {likes.likeCount ?? "—"}
          </button>
          <button className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-300 transition-colors">
            <ThumbsDown size={13} />
            {likes.dislikeCount ?? "—"}
          </button>
        </div>
      )}
    </div>
  );
}
