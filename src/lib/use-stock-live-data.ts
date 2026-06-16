"use client";

import { useEffect, useState } from "react";
import { HISTORY_POLL_MS } from "@/lib/stock-history-cache";
import type { TickerHistoryEntry } from "@/lib/stock-history-cache";
import type { DailyPrice, NewsItem, Stock, WatchStatus } from "@/types";
import type { TradingIntradayCandle, TradingIntradayPoint } from "@/components/TradingCandlestickChart";

type RealtimeQuote = {
  ok: true;
  ticker: string;
  source: string;
  regular: {
    price: number;
    previousClose: number | null;
    change: number | null;
    changePercent: number | null;
    currency: string;
    asOf: string;
  };
  intraday: TradingIntradayPoint[];
  intradayCandles?: TradingIntradayCandle[];
  fetchedAt: string;
};

export type StockHistoryResult = {
  ok: true;
  stock: Stock;
  prices: DailyPrice[];
  price: DailyPrice;
  news: NewsItem[];
  score: number;
  status: WatchStatus;
  mode: "live" | "mock";
  provider: "yahoo" | "alpha_vantage" | "saved" | "local";
  sourceLabel: string;
  warning?: string;
  fetchedAt: string;
};

function historyResultFromEntry(entry: TickerHistoryEntry): StockHistoryResult {
  return {
    ok: true,
    stock: entry.stock,
    prices: entry.prices,
    price: entry.price,
    news: [],
    score: 0,
    status: "Watch",
    mode: entry.mode,
    provider: entry.provider,
    sourceLabel: entry.sourceLabel,
    fetchedAt: entry.fetchedAt
  };
}

async function fetchStockHistory(ticker: string): Promise<StockHistoryResult> {
  const response = await fetch(`/api/stocks/${encodeURIComponent(ticker)}/history`, { cache: "no-store" });
  const payload = await response.json() as StockHistoryResult | { ok: false; error?: string };
  if (!response.ok || !payload.ok) {
    throw new Error("error" in payload ? payload.error ?? "株価履歴を取得できませんでした。" : "株価履歴を取得できませんでした。");
  }
  return payload;
}

export function useStockLiveData(
  ticker: string,
  options?: {
    pollRealtimeMs?: number;
    pollHistoryMs?: number;
    historyRevision?: number;
    seededHistory?: TickerHistoryEntry | null;
  }
) {
  const pollRealtimeMs = options?.pollRealtimeMs ?? 60_000;
  const pollHistoryMs = options?.pollHistoryMs ?? HISTORY_POLL_MS;
  const historyRevision = options?.historyRevision ?? 0;
  const seededHistory = options?.seededHistory ?? null;
  const [historyData, setHistoryData] = useState<StockHistoryResult | null>(null);
  const [historyStatus, setHistoryStatus] = useState<"loading" | "done" | "error">("loading");
  const [historyError, setHistoryError] = useState("");
  const [realtimeQuote, setRealtimeQuote] = useState<RealtimeQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadHistory(preferApi: boolean) {
      if (!preferApi && seededHistory?.stock.ticker === ticker) {
        if (!cancelled) {
          setHistoryData(historyResultFromEntry(seededHistory));
          setHistoryStatus("done");
          setHistoryError("");
        }
        return;
      }

      setHistoryStatus((current) => current === "done" ? "done" : "loading");
      setHistoryError("");
      try {
        const payload = await fetchStockHistory(ticker);
        if (cancelled) return;
        setHistoryData(payload);
        setHistoryStatus("done");
      } catch (error) {
        if (!cancelled) {
          if (seededHistory?.stock.ticker === ticker) {
            setHistoryData(historyResultFromEntry(seededHistory));
            setHistoryStatus("done");
            setHistoryError("");
            return;
          }
          setHistoryData(null);
          setHistoryStatus("error");
          setHistoryError(error instanceof Error ? error.message : "株価履歴を取得できませんでした。");
        }
      }
    }

    void loadHistory(false);
    const timer = window.setInterval(() => {
      void loadHistory(true);
    }, pollHistoryMs);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [ticker, pollHistoryMs, historyRevision, seededHistory]);

  useEffect(() => {
    let cancelled = false;

    async function loadRealtimeQuote() {
      try {
        const response = await fetch(`/api/quote/realtime?ticker=${encodeURIComponent(ticker)}`, { cache: "no-store" });
        const payload = await response.json() as RealtimeQuote | { ok: false; error?: string };
        if (cancelled) return;
        if (!response.ok || !payload.ok) {
          setRealtimeQuote(null);
          setQuoteError("error" in payload ? payload.error ?? "リアルタイム株価を取得できませんでした。" : "リアルタイム株価を取得できませんでした。");
          return;
        }
        setRealtimeQuote(payload);
        setQuoteError(null);
      } catch (error) {
        if (!cancelled) {
          setRealtimeQuote(null);
          setQuoteError(error instanceof Error ? error.message : "リアルタイム株価を取得できませんでした。");
        }
      }
    }

    void loadRealtimeQuote();
    const timer = window.setInterval(loadRealtimeQuote, pollRealtimeMs);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [ticker, pollRealtimeMs]);

  return {
    historyData,
    historyStatus,
    historyError,
    realtimeQuote,
    quoteError
  };
}
