import type { WatchlistLookupPayload } from "@/lib/watchlist-lookup";
import type { DailyPrice, Stock } from "@/types";

export const HISTORY_POLL_MS = 15 * 60 * 1000;

export type TickerHistoryEntry = {
  stock: Stock;
  prices: DailyPrice[];
  price: DailyPrice;
  sourceLabel: string;
  provider: WatchlistLookupPayload["provider"];
  mode: WatchlistLookupPayload["mode"];
  fetchedAt: string;
};

export function buildTickerHistoryEntry(result: WatchlistLookupPayload): TickerHistoryEntry | null {
  if (!result.prices.length || !result.price) return null;
  return {
    stock: result.stock,
    prices: result.prices,
    price: result.price,
    sourceLabel: buildSourceLabel(result.provider, result.mode),
    provider: result.provider,
    mode: result.mode,
    fetchedAt: result.fetchedAt
  };
}

export function isHistoryEntryStale(entry: TickerHistoryEntry | null | undefined, maxAgeMs = HISTORY_POLL_MS) {
  if (!entry) return true;
  const fetchedAt = Date.parse(entry.fetchedAt);
  if (!Number.isFinite(fetchedAt)) return true;
  return Date.now() - fetchedAt > maxAgeMs;
}

function buildSourceLabel(provider: WatchlistLookupPayload["provider"], mode: WatchlistLookupPayload["mode"]) {
  if (provider === "saved") return "Supabase saved history";
  if (provider === "local") return "Local verified history";
  if (provider === "yahoo") return mode === "live" ? "Yahoo Finance / live" : "Yahoo Finance";
  if (provider === "alpha_vantage") return "Alpha Vantage";
  return String(provider);
}
