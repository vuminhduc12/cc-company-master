"use client";

import { useEffect, useMemo, useState } from "react";
import { pricesByTicker, watchlist } from "@/lib/mock-data";
import type { DailyPrice, Stock, WatchStatus, WatchlistItem } from "@/types";

export type SearchMarket = "us" | "jp";

export type CustomWatchItem = WatchlistItem & {
  market: SearchMarket;
  score?: number;
  source?: string;
  fetchedAt?: string;
  latestPrice?: DailyPrice;
};

export const customWatchlistStorageKey = "dfinance.customWatchlist.v1";
export const removedWatchlistStorageKey = "dfinance.removedWatchlistTickers.v1";

export function useUserWatchlist() {
  const [customItems, setCustomItems] = useState<CustomWatchItem[]>([]);
  const [removedTickers, setRemovedTickers] = useState<string[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setCustomItems(loadCustomWatchItems());
    setRemovedTickers(loadRemovedWatchTickers());
    setReady(true);
  }, []);

  const items = useMemo(() => {
    const map = new Map<string, WatchlistItem>();
    watchlist.forEach((item) => {
      if (!removedTickers.includes(item.stock.ticker)) map.set(item.stock.ticker, item);
    });
    customItems.forEach((item) => {
      if (!removedTickers.includes(item.stock.ticker)) map.set(item.stock.ticker, item);
    });
    return [...map.values()].sort((a, b) => a.stock.ticker.localeCompare(b.stock.ticker));
  }, [customItems, removedTickers]);

  return { items, customItems, removedTickers, ready };
}

export function loadCustomWatchItems() {
  if (typeof window === "undefined") return [];
  try {
    const stored = localStorage.getItem(customWatchlistStorageKey);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed.filter(isCustomWatchItem) : [];
  } catch {
    return [];
  }
}

export function loadRemovedWatchTickers() {
  if (typeof window === "undefined") return [];
  try {
    const stored = localStorage.getItem(removedWatchlistStorageKey);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function customPriceSeriesForTicker(ticker: string) {
  const item = loadCustomWatchItems().find((row) => row.stock.ticker === ticker);
  if (!item?.latestPrice) return null;
  return [item.latestPrice];
}

export function getStoredStockForTicker(ticker: string): Stock | null {
  const custom = loadCustomWatchItems().find((item) => item.stock.ticker === ticker)?.stock;
  if (custom) return custom;
  return watchlist.find((item) => item.stock.ticker === ticker)?.stock ?? null;
}

export function normalizeTickerForMarket(ticker: string, market: SearchMarket) {
  const normalized = ticker.trim().toUpperCase();
  if (market === "jp") {
    if (/^\d{4}$/.test(normalized)) return `${normalized}.T`;
    if (/^\d{4}\.JP$/i.test(normalized)) return normalized.replace(/\.JP$/i, ".T");
  }
  return normalized;
}

export function isJapaneseTicker(ticker: string) {
  return /^\d{4}(\.T|\.JP)?$/i.test(ticker);
}

export function hasLocalDetail(ticker: string) {
  return Boolean(pricesByTicker[ticker]);
}

function isCustomWatchItem(value: unknown): value is CustomWatchItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<CustomWatchItem>;
  return Boolean(
    item.stock?.ticker
    && typeof item.currentPrice === "number"
    && typeof item.previousClose === "number"
    && isWatchStatus(item.status)
  );
}

function isWatchStatus(value: unknown): value is WatchStatus {
  return value === "Strong Buy" || value === "Buy" || value === "Watch" || value === "Caution" || value === "Sell";
}
