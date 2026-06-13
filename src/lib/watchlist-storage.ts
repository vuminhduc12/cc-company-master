import { pricesByTicker, watchlist } from "@/lib/mock-data";
import { createBrowserSupabase } from "@/lib/supabase";
import type { DailyPrice, Stock, WatchStatus, WatchlistItem } from "@/types";

export type SearchMarket = "us" | "jp";
export type WatchlistListMarket = "all" | SearchMarket;

export type WatchlistList = {
  id: string;
  name: string;
  market: WatchlistListMarket;
  locked?: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CustomWatchItem = WatchlistItem & {
  market: SearchMarket;
  listIds?: string[];
  score?: number;
  source?: string;
  fetchedAt?: string;
  latestPrice?: DailyPrice;
  priceHistory?: DailyPrice[];
};

export const customWatchlistStorageKey = "dfinance.customWatchlist.v1";
export const removedWatchlistStorageKey = "dfinance.removedWatchlistTickers.v1";
export const watchlistListsStorageKey = "dfinance.watchlistLists.v2";
const watchlistListsMetaTicker = "__WATCHLIST_LISTS__";

export const defaultWatchlistLists: WatchlistList[] = [
  buildDefaultWatchlistList("all", "全Watchlist", "all"),
  buildDefaultWatchlistList("us", "成長株＋米国", "us"),
  buildDefaultWatchlistList("jp", "成長株＋国内", "jp")
];

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

export function loadWatchlistLists() {
  if (typeof window === "undefined") return defaultWatchlistLists;
  try {
    const stored = localStorage.getItem(watchlistListsStorageKey);
    if (!stored) return defaultWatchlistLists;
    const parsed = JSON.parse(stored);
    return normalizeWatchlistLists(parsed);
  } catch {
    return defaultWatchlistLists;
  }
}

export function saveWatchlistLists(lists: WatchlistList[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(watchlistListsStorageKey, JSON.stringify(normalizeWatchlistLists(lists)));
  } catch (error) {
    console.warn("Failed to save watchlist lists.", error);
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
    && Number.isFinite(item.currentPrice)
    && Number.isFinite(item.previousClose)
    && isWatchStatus(item.status)
    && isSearchMarket(item.market ?? "us")
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
  if (error) throw new Error(error.message);
  if (!data) return { customItems: [], removedTickers: [] };
  const customItems: CustomWatchItem[] = [];
  const removedTickers: string[] = [];
  (data as DbWatchlistRow[]).forEach((row) => {
    if (row.ticker === watchlistListsMetaTicker) return;
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

export async function loadDbWatchlistLists(userId: string) {
  const supabase = createBrowserSupabase();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("watchlist_items")
    .select("item")
    .eq("user_id", userId)
    .eq("ticker", watchlistListsMetaTicker)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return normalizeWatchlistLists((data as { item?: unknown } | null)?.item);
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

export async function saveDbWatchlistLists(userId: string, lists: WatchlistList[]) {
  const supabase = createBrowserSupabase();
  if (!supabase) return;
  await supabase.from("watchlist_items").upsert({
    user_id: userId,
    ticker: watchlistListsMetaTicker,
    market: "meta",
    item: normalizeWatchlistLists(lists),
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

function isWatchlistListMarket(value: unknown): value is WatchlistListMarket {
  return value === "all" || value === "us" || value === "jp";
}

function buildDefaultWatchlistList(id: WatchlistListMarket, name: string, market: WatchlistListMarket): WatchlistList {
  return {
    id,
    name,
    market,
    locked: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

export function normalizeWatchlistLists(value: unknown): WatchlistList[] {
  const rows = Array.isArray(value) ? value : [];
  const normalized = rows.flatMap((row): WatchlistList[] => {
    if (!row || typeof row !== "object") return [];
    const candidate = row as Partial<WatchlistList>;
    const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
    const name = normalizeListName(candidate.name);
    if (!id || !name || !isWatchlistListMarket(candidate.market)) return [];
    return [{
      id,
      name,
      market: candidate.market,
      locked: Boolean(candidate.locked),
      createdAt: typeof candidate.createdAt === "string" ? candidate.createdAt : new Date().toISOString(),
      updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : new Date().toISOString()
    }];
  });

  const byId = new Map<string, WatchlistList>();
  [...defaultWatchlistLists, ...normalized].forEach((list) => {
    const defaultList = defaultWatchlistLists.find((row) => row.id === list.id);
    byId.set(list.id, {
      ...list,
      locked: defaultList?.locked ?? list.locked,
      market: defaultList?.market ?? list.market
    });
  });
  return Array.from(byId.values());
}

export function normalizeListName(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ").slice(0, 24);
}
