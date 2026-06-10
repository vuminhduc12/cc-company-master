"use client";

import { pricesByTicker, watchlist } from "@/lib/mock-data";
import { createBrowserSupabase } from "@/lib/supabase";
import type { DailyPrice, Stock, WatchStatus, WatchlistItem } from "@/types";

export { useUserWatchlist, WatchlistProvider } from "@/lib/watchlist-context";

export type SearchMarket = "us" | "jp";

export type CustomWatchItem = WatchlistItem & {
  market: SearchMarket;
  score?: number;
  source?: string;
  fetchedAt?: string;
  latestPrice?: DailyPrice;
  priceHistory?: DailyPrice[];
};

export const customWatchlistStorageKey = "dfinance.customWatchlist.v1";
export const removedWatchlistStorageKey = "dfinance.removedWatchlistTickers.v1";

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

type DbWatchlistRow = {
  ticker: string;
  market: SearchMarket | string | null;
  item: unknown;
  removed: boolean | null;
};

export async function loadDbWatchlistState(userId: string) {
  const supabase = createBrowserSupabase();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("watchlist_items")
    .select("ticker, market, item, removed")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });
  if (error || !data) return null;
  const customItems: CustomWatchItem[] = [];
  const removedTickers: string[] = [];
  (data as DbWatchlistRow[]).forEach((row) => {
    if (row.removed) {
      removedTickers.push(row.ticker);
      return;
    }
    if (isCustomWatchItem(row.item)) {
      customItems.push({ ...row.item, market: isSearchMarket(row.market) ? row.market : row.item.market });
    }
  });
  return { customItems, removedTickers };
}

export async function saveDbWatchItem(userId: string, item: CustomWatchItem) {
  const supabase = createBrowserSupabase();
  if (!supabase) return;
  await supabase.from("watchlist_items").upsert({
    user_id: userId,
    ticker: item.stock.ticker,
    market: item.market,
    item,
    removed: false,
    updated_at: new Date().toISOString()
  }, { onConflict: "user_id,ticker" });
}

export async function saveDbWatchItems(userId: string, items: CustomWatchItem[]) {
  if (items.length === 0) return;
  await Promise.all(items.map((item) => saveDbWatchItem(userId, item)));
}

export async function markDbWatchTickerRemoved(userId: string, ticker: string, market: SearchMarket = "us") {
  const supabase = createBrowserSupabase();
  if (!supabase) return;
  await supabase.from("watchlist_items").upsert({
    user_id: userId,
    ticker,
    market,
    item: null,
    removed: true,
    updated_at: new Date().toISOString()
  }, { onConflict: "user_id,ticker" });
}

export async function restoreDbRemovedDefaults(userId: string) {
  const supabase = createBrowserSupabase();
  if (!supabase) return;
  await supabase
    .from("watchlist_items")
    .delete()
    .eq("user_id", userId)
    .eq("removed", true);
}

export async function migrateLocalWatchlistToDb(userId: string, customItems: CustomWatchItem[], removedTickers: string[]) {
  await Promise.all([
    ...customItems.map((item) => saveDbWatchItem(userId, item)),
    ...removedTickers.map((ticker) => markDbWatchTickerRemoved(userId, ticker, isJapaneseTicker(ticker) ? "jp" : "us"))
  ]);
}

function isSearchMarket(value: unknown): value is SearchMarket {
  return value === "us" || value === "jp";
}
