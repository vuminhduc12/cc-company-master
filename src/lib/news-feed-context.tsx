"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { NEWS_FEED_POLL_MS, newsForTicker } from "@/lib/news-feed";
import { resolveVisibleWatchlist } from "@/lib/watchlist-display";
import { useUserWatchlist } from "@/lib/user-watchlist";
import type { NewsItem } from "@/types";

export type NewsFeedStatus = "idle" | "loading" | "ready" | "error";

export type NewsFeedContextValue = {
  news: NewsItem[];
  source: string;
  fetchedAt: string | null;
  warning: string;
  status: NewsFeedStatus;
  lastCronAt: string | null;
  refresh: () => Promise<void>;
  newsFor: (ticker: string) => NewsItem[];
};

const defaultValue: NewsFeedContextValue = {
  news: [],
  source: "未取得",
  fetchedAt: null,
  warning: "",
  status: "idle",
  lastCronAt: null,
  refresh: async () => undefined,
  newsFor: () => []
};

const NewsFeedContext = createContext<NewsFeedContextValue>(defaultValue);

type FeedResponse =
  | {
      ok: true;
      news: NewsItem[];
      source: string;
      fetchedAt: string;
      warning?: string;
      lastCronAt?: string | null;
    }
  | { ok: false; error?: string };

export function NewsFeedProvider({ children }: { children: ReactNode }) {
  const userWatchlist = useUserWatchlist();
  const tickers = useMemo(
    () => resolveVisibleWatchlist(userWatchlist.items).map((item) => item.stock.ticker),
    [userWatchlist.items]
  );
  const tickerKey = useMemo(
    () => [...new Set(tickers.map((ticker) => ticker.trim().toUpperCase()).filter(Boolean))].sort().join(","),
    [tickers]
  );

  const [news, setNews] = useState<NewsItem[]>([]);
  const [source, setSource] = useState("未取得");
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [warning, setWarning] = useState("");
  const [status, setStatus] = useState<NewsFeedStatus>("idle");
  const [lastCronAt, setLastCronAt] = useState<string | null>(null);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (!tickerKey) {
      setNews([]);
      setSource("未取得");
      setFetchedAt(null);
      setWarning("");
      setLastCronAt(null);
      setStatus("ready");
      return;
    }
    if (inFlight.current) return;
    inFlight.current = true;
    setStatus((current) => (current === "ready" ? "loading" : current === "idle" ? "loading" : current));

    try {
      const response = await fetch(`/api/news/feed?tickers=${encodeURIComponent(tickerKey)}`, { cache: "no-store" });
      const payload = await response.json() as FeedResponse;
      if (!response.ok || !payload.ok) {
        setStatus("error");
        setWarning("error" in payload && payload.error ? payload.error : "ニュース自動取得に失敗しました。");
        return;
      }
      setNews(payload.news);
      setSource(payload.source);
      setFetchedAt(payload.fetchedAt);
      setLastCronAt(payload.lastCronAt ?? null);
      setWarning(payload.warning ?? "");
      setStatus("ready");
    } catch {
      setStatus("error");
      setWarning("ニュース自動取得に失敗しました。");
    } finally {
      inFlight.current = false;
    }
  }, [tickerKey]);

  useEffect(() => {
    void load();

    const timer = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      void load();
    }, NEWS_FEED_POLL_MS);

    function onVisibility() {
      if (document.visibilityState === "visible") void load();
    }
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load]);

  const value = useMemo<NewsFeedContextValue>(() => ({
    news,
    source,
    fetchedAt,
    warning,
    status,
    lastCronAt,
    refresh: load,
    newsFor: (ticker: string) => newsForTicker(news, ticker)
  }), [fetchedAt, lastCronAt, load, news, source, status, warning]);

  return <NewsFeedContext.Provider value={value}>{children}</NewsFeedContext.Provider>;
}

export function useNewsFeed() {
  return useContext(NewsFeedContext);
}

/** @deprecated Prefer useNewsFeed() from the shared provider. */
export function useAutoNewsFeed(_tickers?: string[], _focusTicker?: string) {
  return useNewsFeed();
}
