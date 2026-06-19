"use client";

import { useEffect, useState } from "react";

type QuoteState = {
  price: number | null;
  change: number | null;
  changePercent: number | null;
  loading: boolean;
};

type IndexQuote = QuoteState & { symbol: string; label: string };

const INDICES = [
  { symbol: "^N225", label: "日経 225", flag: "🇯🇵" },
  { symbol: "^GSPC", label: "S&P 500", flag: "🇺🇸" },
  { symbol: "^DJI", label: "Dow Jones", flag: "🇺🇸" },
  { symbol: "^VIX", label: "VIX", flag: "📊" },
];

const EMPTY: QuoteState = { price: null, change: null, changePercent: null, loading: true };

/** 全インデックスを 600ms 間隔で順次フェッチ → Yahoo Finance レート制限を回避 */
function useAllIndices() {
  const [quotes, setQuotes] = useState<Record<string, QuoteState>>(
    () => Object.fromEntries(INDICES.map((i) => [i.symbol, EMPTY]))
  );

  useEffect(() => {
    let cancelled = false;

    async function loadAll() {
      for (let i = 0; i < INDICES.length; i++) {
        if (cancelled) return;
        // 2件目以降は 600ms ずらして送信
        if (i > 0) await new Promise<void>((r) => setTimeout(r, 600 * i));
        if (cancelled) return;
        const sym = INDICES[i].symbol;
        try {
          const res = await fetch(
            `/api/quote/realtime?ticker=${encodeURIComponent(sym)}`,
            { cache: "no-store" }
          );
          const data = await res.json() as { ok: boolean; regular?: { price: number; change: number; changePercent: number } };
          if (cancelled) return;
          setQuotes((prev) => ({
            ...prev,
            [sym]: data.ok && data.regular
              ? { price: data.regular.price, change: data.regular.change, changePercent: data.regular.changePercent, loading: false }
              : { ...prev[sym], loading: false },
          }));
        } catch {
          if (!cancelled) setQuotes((prev) => ({ ...prev, [sym]: { ...prev[sym], loading: false } }));
        }
      }
    }

    void loadAll();
    // 5分ごとに全件再フェッチ
    const timer = window.setInterval(() => void loadAll(), 5 * 60 * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  return quotes;
}

function IndexCard({
  symbol,
  label,
  flag,
  quoteState,
}: {
  symbol: string;
  label: string;
  flag: string;
  quoteState: QuoteState;
}) {
  const { price, change, changePercent, loading } = quoteState;
  const isUp = (changePercent ?? 0) >= 0;
  const upColor = "text-emerald-300";
  const downColor = "text-red-400";
  const valueColor = isUp ? upColor : downColor;
  const borderColor = isUp
    ? "border-emerald-300/20"
    : "border-red-400/20";
  const bgGlow = isUp
    ? "bg-emerald-400/[0.04]"
    : "bg-red-400/[0.04]";

  if (loading) {
    return (
      <div className="flex min-w-[130px] flex-col gap-1 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3">
        <div className="h-3 w-20 animate-pulse rounded bg-slate-700" />
        <div className="h-5 w-28 animate-pulse rounded bg-slate-700" />
        <div className="h-3 w-14 animate-pulse rounded bg-slate-700" />
      </div>
    );
  }

  return (
    <div
      className={`flex min-w-[130px] flex-col gap-0.5 rounded-xl border ${borderColor} ${bgGlow} px-4 py-3 transition-colors`}
    >
      <p className="text-[11px] font-bold text-slate-400">
        {flag} {label}
      </p>
      <p className="text-base font-black tabular-nums text-slate-50">
        {price !== null ? formatIndexPrice(symbol, price) : "—"}
      </p>
      <p className={`text-[11px] font-bold tabular-nums ${valueColor}`}>
        {changePercent !== null
          ? `${isUp ? "+" : ""}${changePercent.toFixed(2)}%`
          : "—"}
        {change !== null && symbol !== "^VIX"
          ? ` (${isUp ? "+" : ""}${formatIndexChange(symbol, change)})`
          : ""}
      </p>
    </div>
  );
}

export function MarketHeroStrip() {
  const quotes = useAllIndices();
  const now = new Date();
  const hour = now.getHours();
  // JST市場時間の判定（UTC+9）
  const jstHour = (hour + 9) % 24;
  const tokyoOpen = jstHour >= 9 && jstHour < 15;
  const nyOpen = hour >= 14 && hour < 21; // UTC 14-21 = NY 9am-4pm EST

  return (
    <div className="rounded-2xl border border-white/10 bg-[linear-gradient(135deg,rgba(15,23,42,0.95),rgba(2,6,23,0.98))] px-4 py-4 shadow-xl shadow-black/20 ring-1 ring-white/5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">
            Market Overview
          </span>
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-black ${
              tokyoOpen
                ? "border border-emerald-300/30 bg-emerald-300/10 text-emerald-200"
                : "border border-slate-700 bg-slate-800 text-slate-500"
            }`}
          >
            {tokyoOpen ? "🟢 TSE Open" : "⚫ TSE Closed"}
          </span>
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-black ${
              nyOpen
                ? "border border-blue-300/30 bg-blue-300/10 text-blue-200"
                : "border border-slate-700 bg-slate-800 text-slate-500"
            }`}
          >
            {nyOpen ? "🟢 NYSE Open" : "⚫ NYSE Closed"}
          </span>
        </div>
        <p className="text-[10px] text-slate-600">
          {now.toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" })} JST
        </p>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch]">
        {INDICES.map((idx) => (
          <IndexCard key={idx.symbol} {...idx} quoteState={quotes[idx.symbol] ?? EMPTY} />
        ))}
      </div>
    </div>
  );
}

function formatIndexPrice(symbol: string, price: number) {
  if (symbol === "^N225") {
    return `¥${price.toLocaleString("ja-JP", { maximumFractionDigits: 0 })}`;
  }
  if (symbol === "^VIX") {
    return price.toFixed(2);
  }
  return `$${price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatIndexChange(symbol: string, change: number) {
  if (symbol === "^N225") return Math.round(change).toLocaleString("ja-JP");
  return change.toFixed(2);
}
