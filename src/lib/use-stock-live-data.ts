"use client";

import { useEffect, useState } from "react";
import type { DailyPrice, NewsItem, Stock, WatchStatus } from "@/types";

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

export function useStockLiveData(ticker: string, options?: { pollRealtimeMs?: number }) {
  const pollRealtimeMs = options?.pollRealtimeMs ?? 60_000;
  const [historyData, setHistoryData] = useState<StockHistoryResult | null>(null);
  const [historyStatus, setHistoryStatus] = useState<"loading" | "done" | "error">("loading");
  const [historyError, setHistoryError] = useState("");
  const [realtimeQuote, setRealtimeQuote] = useState<RealtimeQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadHistory() {
      setHistoryStatus("loading");
      setHistoryError("");
      try {
        const response = await fetch(`/api/stocks/${encodeURIComponent(ticker)}/history`, { cache: "no-store" });
        const payload = await response.json() as StockHistoryResult | { ok: false; error?: string };
        if (cancelled) return;
        if (!response.ok || !payload.ok) {
          setHistoryData(null);
          setHistoryStatus("error");
          setHistoryError("error" in payload ? payload.error ?? "株価履歴を取得できませんでした。" : "株価履歴を取得できませんでした。");
          return;
        }
        setHistoryData(payload);
        setHistoryStatus("done");
      } catch (error) {
        if (!cancelled) {
          setHistoryData(null);
          setHistoryStatus("error");
          setHistoryError(error instanceof Error ? error.message : "株価履歴を取得できませんでした。");
        }
      }
    }

    void loadHistory();
    return () => {
      cancelled = true;
    };
  }, [ticker]);

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
