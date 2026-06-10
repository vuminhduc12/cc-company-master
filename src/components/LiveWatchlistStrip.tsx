"use client";

import Link from "next/link";
import { useUserWatchlist } from "@/lib/watchlist-context";
import { isJapaneseTicker } from "@/lib/watchlist-storage";
import { quoteFromWatchItem } from "@/lib/watchlist-display";

export function LiveWatchlistStrip() {
  const watchlistState = useUserWatchlist();
  const { items, refreshStatus, refreshMessage } = watchlistState;

  if (items.length === 0) return null;

  return (
    <section className="rounded-2xl border border-white/10 bg-slate-900/80 p-4 shadow-xl shadow-black/20 ring-1 ring-white/5">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-300">Live Watchlist</p>
          <p className="mt-1 text-xs text-slate-500">
            {refreshStatus === "running" ? "リアルデータを更新中…" : refreshMessage || "全ページで共有される最新株価です。"}
          </p>
        </div>
        <button
          className="rounded-full border border-sky-300/30 bg-sky-300/10 px-4 py-2 text-xs font-black text-sky-100 hover:bg-sky-300/20 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={refreshStatus === "running"}
          onClick={() => void watchlistState.refreshAll()}
          type="button"
        >
          {refreshStatus === "running" ? "更新中..." : "再取得"}
        </button>
      </div>
      <div className="mt-3 flex gap-2 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch]">
        {items.map((item) => {
          const quote = quoteFromWatchItem(item);
          return (
            <Link
              key={item.stock.ticker}
              className="min-w-[132px] rounded-xl border border-white/10 bg-slate-950/55 px-3 py-2 transition hover:border-sky-300/30 hover:bg-sky-300/10"
              href={`/stocks/${item.stock.ticker}`}
            >
              <p className="text-xs font-black text-sky-100">{item.stock.ticker}</p>
              <p className="mt-1 text-sm font-bold text-slate-50">{formatPrice(item.stock.ticker, quote.price)}</p>
              <p className={`mt-0.5 text-xs font-semibold ${quote.changePercent >= 0 ? "text-green-400" : "text-red-400"}`}>
                {quote.price ? `${quote.changePercent >= 0 ? "+" : ""}${quote.changePercent.toFixed(2)}%` : "-"}
              </p>
              <p className="mt-1 truncate text-[10px] text-slate-500">{item.source ?? "live"}</p>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function formatPrice(ticker: string, value: number | null) {
  if (value === null || !Number.isFinite(value) || value <= 0) return "-";
  if (isJapaneseTicker(ticker)) return `${Math.round(value).toLocaleString("ja-JP")}円`;
  return `$${value.toFixed(2)}`;
}
