"use client";

/** 汎用スケルトンパルスUI */
export function SkeletonLine({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded bg-slate-700/50 ${className}`}
      aria-hidden="true"
    />
  );
}

export function SkeletonPrice() {
  return (
    <div className="space-y-1.5">
      <SkeletonLine className="h-8 w-32" />
      <SkeletonLine className="h-4 w-20" />
    </div>
  );
}

export function SkeletonCard({ rows = 3 }: { rows?: number }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-slate-900/60 p-4 space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonLine key={i} className={`h-4 ${i === 0 ? "w-2/3" : i % 2 === 0 ? "w-full" : "w-5/6"}`} />
      ))}
    </div>
  );
}

export function SkeletonWatchlistRow() {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-white/8 bg-slate-900/50 px-3 py-2.5">
      <div className="space-y-1.5">
        <SkeletonLine className="h-4 w-16" />
        <SkeletonLine className="h-3 w-24" />
      </div>
      <div className="space-y-1.5 text-right">
        <SkeletonLine className="h-4 w-14" />
        <SkeletonLine className="h-3 w-10" />
      </div>
    </div>
  );
}
