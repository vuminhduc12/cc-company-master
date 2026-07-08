"use client";

import { useEffect, useMemo, useState } from "react";
import { NEWS_FEED_POLL_MS } from "@/lib/news-feed";
import type { NewsItem } from "@/types";

export type AutoNewsFeedMode = "idle" | "cached" | "live-scan";

export type AutoNewsFeedState = {
  news: NewsItem[];
  source: string;
  fetchedAt: string | null;
  mode: AutoNewsFeedMode;
  warning: string;
  status: "idle" | "loading" | "ready" | "error";
};

type FeedResponse =
  | {
      ok: true;
      news: NewsItem[];
      source: string;
      fetchedAt: string;
      mode: "cached" | "live-scan";
      warning?: string;
    }
  | { ok: false; error?: string };

export function useAutoNewsFeed(tickers: string[], focusTicker?: string) {
  const tickerKey = useMemo(
    () => [...new Set(tickers.map((ticker) => ticker.trim().toUpperCase()).filter(Boolean))].sort().join(","),
    [tickers]
  );
  const [state, setState] = useState<AutoNewsFeedState>({
    news: [],
    source: "未取得",
    fetchedAt: null,
    mode: "idle",
    warning: "",
    status: "idle"
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!tickerKey) {
        setState((current) => ({
          ...current,
          news: [],
          source: "未取得",
          fetchedAt: null,
          mode: "idle",
          status: "ready"
        }));
        return;
      }

      setState((current) => ({
        ...current,
        status: current.status === "ready" ? "loading" : current.status
      }));

      try {
        const params = new URLSearchParams({ tickers: tickerKey });
        if (focusTicker) params.set("focus", focusTicker.trim().toUpperCase());
        const response = await fetch(`/api/news/feed?${params.toString()}`, { cache: "no-store" });
        const payload = await response.json() as FeedResponse;
        if (cancelled) return;

        if (!response.ok || !payload.ok) {
          setState((current) => ({
            ...current,
            status: "error",
            warning: "error" in payload && payload.error ? payload.error : "ニュース自動取得に失敗しました。"
          }));
          return;
        }

        setState({
          news: payload.news,
          source: payload.source,
          fetchedAt: payload.fetchedAt,
          mode: payload.mode,
          warning: payload.warning ?? "",
          status: "ready"
        });
      } catch {
        if (!cancelled) {
          setState((current) => ({
            ...current,
            status: "error",
            warning: "ニュース自動取得に失敗しました。"
          }));
        }
      }
    }

    void load();
    const timer = window.setInterval(load, NEWS_FEED_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [focusTicker, tickerKey]);

  return state;
}
