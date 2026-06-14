import { cn } from "../lib/utils";

export function Spinner({ className }) {
  return (
    <div className={cn("w-5 h-5 rounded-full border-2 border-zinc-700 border-t-accent animate-spin", className)} />
  );
}

export function CardSkeleton() {
  return (
    <div className="rounded-lg overflow-hidden bg-surface-card border border-surface-border animate-pulse">
      <div className="aspect-[3/4] bg-surface-muted" />
      <div className="p-2 space-y-1.5">
        <div className="h-3 bg-surface-muted rounded w-4/5" />
        <div className="h-3 bg-surface-muted rounded w-3/5" />
      </div>
    </div>
  );
}

export function GridSkeleton({ count = 12 }) {
  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
      {Array.from({ length: count }).map((_, i) => <CardSkeleton key={i} />)}
    </div>
  );
}

export function Loading({ label = "Memuat..." }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-zinc-500 text-sm">
      <Spinner />
      {label}
    </div>
  );
}
