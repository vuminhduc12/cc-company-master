"use client";

import { useEffect, useRef, useState } from "react";
import {
  isJapaneseTicker,
  normalizeTickerForMarket,
  saveDbWatchItem,
  type CustomWatchItem,
  type SearchMarket,
} from "@/lib/user-watchlist";
import { analyzeStock } from "@/lib/scoring";

type LookupResult = {
  ok: true;
  stock: { ticker: string; companyName: string; sector: string; exchange: string };
  price: { close: number; changePercent: number; rsi: number; volumeRatio: number; date: string; [key: string]: unknown };
  previousClose: number;
  score: number;
  status: string;
  prices: unknown[];
  warning?: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onAdded: (item: CustomWatchItem) => void;
  userId?: string;
};

export function QuickAddModal({ open, onClose, onAdded, userId }: Props) {
  const [ticker, setTicker] = useState("");
  const [market, setMarket] = useState<SearchMarket>("us");
  const [status, setStatus] = useState<"idle" | "searching" | "found" | "error">("idle");
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<LookupResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // モーダルが開いたらフォーカス
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setTicker("");
      setResult(null);
      setStatus("idle");
      setMessage("");
    }
  }, [open]);

  // Escキーで閉じる
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // ティッカー入力時に市場を自動判定
  function handleTickerChange(value: string) {
    setTicker(value);
    if (isJapaneseTicker(value.trim())) setMarket("jp");
    else if (value.trim() && !/^\d/.test(value.trim())) setMarket("us");
  }

  async function handleSearch() {
    const normalized = normalizeTickerForMarket(ticker.trim(), market);
    if (!normalized) return;
    setStatus("searching");
    setMessage("");
    setResult(null);
    try {
      const response = await fetch("/api/watchlist/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker: normalized, market }),
      });
      const payload = await response.json() as LookupResult | { ok: false; error?: string };
      if (!response.ok || !payload.ok) {
        setStatus("error");
        setMessage(
          "error" in payload && payload.error
            ? payload.error
            : "銘柄が見つかりませんでした。ティッカーを確認してください。"
        );
        return;
      }
      setResult(payload);
      setStatus("found");
      setMessage(payload.warning ?? `${payload.stock.ticker}を取得しました。Watchlistに追加できます。`);
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "取得に失敗しました。");
    }
  }

  async function handleAdd() {
    if (!result) return;
    const price = result.price as Parameters<typeof analyzeStock>[0];
    const newItem: CustomWatchItem = {
      stock: result.stock,
      currentPrice: result.price.close as number,
      previousClose: result.previousClose,
      shares: 0,
      averagePrice: 0,
      status: result.status as CustomWatchItem["status"],
      memo: "",
      market,
      score: result.score,
      latestPrice: price,
      priceHistory: result.prices as CustomWatchItem["priceHistory"],
      fetchedAt: new Date().toISOString(),
    };
    if (userId) await saveDbWatchItem(userId, newItem);
    onAdded(newItem);
    onClose();
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* 背景オーバーレイ */}
      <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm" />

      {/* モーダル本体 */}
      <div className="relative z-10 w-full max-w-lg rounded-2xl border border-cyan-300/20 bg-slate-900 p-6 shadow-2xl shadow-black/40 ring-1 ring-white/5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300">Quick Add</p>
            <h3 className="mt-1 text-lg font-semibold text-slate-50">銘柄をWatchlistに追加</h3>
          </div>
          <button
            className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-slate-100"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        {/* 入力エリア */}
        <div className="mt-4 flex gap-2">
          <select
            className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-slate-50 outline-none focus:border-cyan-300/50"
            value={market}
            onChange={(e) => setMarket(e.target.value as SearchMarket)}
          >
            <option value="us">🇺🇸 米国</option>
            <option value="jp">🇯🇵 日本</option>
          </select>
          <input
            ref={inputRef}
            className="min-w-0 flex-1 rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-slate-50 outline-none focus:border-cyan-300/50"
            placeholder={market === "us" ? "例: AAPL, TSLA, NVDA" : "例: 7203, 9984"}
            value={ticker}
            onChange={(e) => handleTickerChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void handleSearch(); }}
          />
          <button
            className="rounded-xl bg-cyan-300 px-4 py-2 text-sm font-black text-slate-950 hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!ticker.trim() || status === "searching"}
            onClick={() => void handleSearch()}
          >
            {status === "searching" ? "検索中…" : "検索"}
          </button>
        </div>

        {/* メッセージ */}
        {message && (
          <p className={`mt-3 rounded-xl border px-3 py-2 text-xs leading-5 ${
            status === "error"
              ? "border-red-300/25 bg-red-400/10 text-red-100"
              : "border-emerald-300/25 bg-emerald-300/10 text-emerald-100"
          }`}>
            {message}
          </p>
        )}

        {/* 検索結果プレビュー */}
        {result && status === "found" && (
          <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/60 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-base font-black text-slate-50">{result.stock.ticker}</p>
                <p className="mt-0.5 text-sm text-slate-400">{result.stock.companyName}</p>
                <p className="mt-1 text-xs text-slate-500">{result.stock.exchange} · {result.stock.sector}</p>
              </div>
              <div className="text-right">
                <p className="text-lg font-black text-slate-50">
                  ${(result.price.close as number).toFixed(2)}
                </p>
                <p className={`text-sm font-semibold ${
                  (result.price.changePercent as number) >= 0 ? "text-emerald-400" : "text-red-400"
                }`}>
                  {(result.price.changePercent as number) >= 0 ? "+" : ""}
                  {(result.price.changePercent as number).toFixed(2)}%
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  AI Score {result.score} · {result.status}
                </p>
              </div>
            </div>
            <button
              className="mt-4 w-full rounded-xl bg-cyan-300 px-4 py-2.5 text-sm font-black text-slate-950 hover:bg-cyan-200"
              onClick={() => void handleAdd()}
            >
              + Watchlistに追加
            </button>
          </div>
        )}

        <p className="mt-4 text-xs text-slate-600">
          米国株はティッカー（AAPL等）、日本株は4桁証券コード（7203等）で検索できます。
        </p>
      </div>
    </div>
  );
}
