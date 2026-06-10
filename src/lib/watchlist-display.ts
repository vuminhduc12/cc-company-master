import { watchlist } from "@/lib/mock-data";
import type { CustomWatchItem } from "@/lib/watchlist-storage";
import type { RealtimeQuoteSnapshot } from "@/lib/indicators";
import type { WatchlistItem } from "@/types";

export type WatchItemQuote = {
  price: number | null;
  previousClose: number;
  changePercent: number;
};

export function resolveVisibleWatchlist(items: CustomWatchItem[]) {
  return items.length > 0 ? items : watchlist;
}

export function quoteFromWatchItem(item: CustomWatchItem | WatchlistItem): WatchItemQuote {
  const latestPrice = "latestPrice" in item ? item.latestPrice : undefined;
  const price = latestPrice?.close ?? item.currentPrice;
  const previousClose = item.previousClose > 0
    ? item.previousClose
    : latestPrice && price > 0 && Number.isFinite(latestPrice.changePercent)
      ? price / (1 + latestPrice.changePercent / 100)
      : price;

  if (!Number.isFinite(price) || price <= 0) {
    return { price: null, previousClose, changePercent: 0 };
  }

  const changePercent = previousClose > 0 ? ((price - previousClose) / previousClose) * 100 : 0;
  return { price, previousClose, changePercent };
}

export function quoteForWatchItem(
  item: CustomWatchItem | WatchlistItem,
  options?: { selectedTicker?: string; realtimeQuote?: RealtimeQuoteSnapshot | null }
) {
  if (
    options?.selectedTicker
    && options.realtimeQuote
    && item.stock.ticker === options.selectedTicker
    && Number.isFinite(options.realtimeQuote.regular.price)
    && options.realtimeQuote.regular.price > 0
  ) {
    const price = options.realtimeQuote.regular.price;
    const previousClose = options.realtimeQuote.regular.previousClose ?? quoteFromWatchItem(item).previousClose;
    const changePercent = options.realtimeQuote.regular.changePercent
      ?? (previousClose > 0 ? ((price - previousClose) / previousClose) * 100 : 0);
    return { price, previousClose, changePercent };
  }

  return quoteFromWatchItem(item);
}
