import { watchlist } from "@/lib/mock-data";
import { createServerSupabase, hasSupabaseConfig } from "@/lib/supabase";
import type { WatchStatus, WatchlistItem } from "@/types";

const watchlistListsMetaTicker = "__WATCHLIST_LISTS__";

type WatchlistRow = {
  ticker: string;
  market: string | null;
  item: unknown;
  removed: boolean | null;
};

export async function loadServerWatchlistItems() {
  const supabase = createServerSupabase();
  if (!supabase) {
    return {
      items: watchlist,
      source: "mock-data",
      warning: hasSupabaseConfig() ? "SUPABASE_SERVICE_ROLE_KEY is not configured. Falling back to mock watchlist." : undefined
    };
  }

  const { data, error } = await supabase
    .from("watchlist_items")
    .select("ticker, market, item, removed")
    .neq("ticker", watchlistListsMetaTicker)
    .eq("removed", false)
    .order("updated_at", { ascending: false });

  if (error) throw new Error(`Supabase watchlist_items load failed: ${error.message}`);

  const byTicker = new Map<string, WatchlistItem>();
  for (const row of (data ?? []) as WatchlistRow[]) {
    const item = watchlistItemFromRow(row);
    if (!item || byTicker.has(item.stock.ticker)) continue;
    byTicker.set(item.stock.ticker, item);
  }

  return {
    items: Array.from(byTicker.values()),
    source: "supabase-watchlist-items"
  };
}

function watchlistItemFromRow(row: WatchlistRow): WatchlistItem | null {
  if (isWatchlistItem(row.item)) {
    return {
      ...row.item,
      stock: {
        ...row.item.stock,
        ticker: row.item.stock.ticker.toUpperCase()
      }
    };
  }

  const ticker = String(row.ticker ?? "").trim().toUpperCase();
  if (!ticker || ticker === watchlistListsMetaTicker) return null;
  return {
    stock: {
      ticker,
      companyName: ticker,
      sector: "Unknown",
      exchange: row.market === "jp" || ticker.endsWith(".T") ? "TSE" : "NASDAQ/NYSE"
    },
    shares: 0,
    averagePrice: 0,
    currentPrice: 0,
    previousClose: 0,
    status: "Watch",
    memo: "Supabase watchlist_itemsから読み込み"
  };
}

function isWatchlistItem(value: unknown): value is WatchlistItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<WatchlistItem>;
  return Boolean(
    item.stock
    && typeof item.stock === "object"
    && typeof item.stock.ticker === "string"
    && typeof item.stock.companyName === "string"
    && typeof item.stock.sector === "string"
    && typeof item.stock.exchange === "string"
    && isWatchStatus(item.status)
  );
}

function isWatchStatus(value: unknown): value is WatchStatus {
  return value === "Strong Buy" || value === "Buy" || value === "Watch" || value === "Caution" || value === "Sell";
}
