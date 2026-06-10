import { resolvePriceSeries } from "@/lib/indicators";
import { pricesByTicker, watchlist } from "@/lib/mock-data";
import { statusFromScore } from "@/lib/scoring";
import type { CustomWatchItem, SearchMarket } from "@/lib/user-watchlist";
import { isJapaneseTicker } from "@/lib/user-watchlist";
import type { WatchlistLookupPayload } from "@/lib/watchlist-lookup";
import type { AiJobResult } from "@/types";

export type WatchlistRefreshFailure = {
  ticker: string;
  ok: false;
  error: string;
};

export type WatchlistRefreshSuccess = WatchlistLookupPayload & {
  ticker: string;
};

export type WatchlistRefreshResult = WatchlistRefreshSuccess | WatchlistRefreshFailure;

export type WatchlistBatchRefreshResponse = {
  ok: true;
  successCount: number;
  failureCount: number;
  results: WatchlistRefreshResult[];
};

export async function refreshWatchlistBatch(items: Array<{ ticker: string; market: SearchMarket }>) {
  if (items.length === 0) {
    return { ok: true as const, successCount: 0, failureCount: 0, results: [] };
  }

  const response = await fetch("/api/watchlist/refresh", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ items })
  });
  const payload = await response.json() as WatchlistBatchRefreshResponse | { ok: false; error?: string };
  if (!response.ok || !payload.ok) {
    throw new Error("error" in payload ? payload.error ?? "Watchlist一括更新に失敗しました。" : "Watchlist一括更新に失敗しました。");
  }
  return payload;
}

export function applyWatchlistRefresh(base: CustomWatchItem, result: WatchlistLookupPayload): CustomWatchItem {
  return {
    ...base,
    stock: result.stock,
    currentPrice: result.price.close,
    previousClose: result.previousClose,
    status: result.status,
    score: result.score,
    source: result.provider,
    fetchedAt: result.fetchedAt,
    memo: result.warning ?? `${result.provider} / ${result.mode} / ${formatDateTime(result.fetchedAt)}`,
    latestPrice: result.price
  };
}

export function mergeRefreshedCustomItems(current: CustomWatchItem[], refreshed: CustomWatchItem[]) {
  const refreshedMap = new Map(refreshed.map((item) => [item.stock.ticker, item]));
  const nextCustom = current.map((item) => refreshedMap.get(item.stock.ticker) ?? item);
  refreshed.forEach((item) => {
    if (!nextCustom.some((row) => row.stock.ticker === item.stock.ticker)) {
      nextCustom.push(item);
    }
  });
  return nextCustom;
}

export function buildDefaultCustomItems(removedTickers: string[], jobResult: AiJobResult | null) {
  return watchlist
    .filter((item) => !removedTickers.includes(item.stock.ticker))
    .map<CustomWatchItem>((item) => {
      const live = jobResult?.stocks?.find((stockResult) => stockResult.stock.ticker === item.stock.ticker);
      const rowBasePrices = pricesByTicker[item.stock.ticker];
      const rowResolved = rowBasePrices ? resolvePriceSeries(rowBasePrices, live?.prices, live?.price) : null;
      const rowLatest = rowResolved?.prices.at(-1);
      const currentPrice = rowLatest?.close ?? live?.price.close ?? item.currentPrice;
      const previousClose = rowResolved?.prices.at(-2)?.close ?? (live ? currentPrice / (1 + live.price.changePercent / 100) : item.previousClose);
      return {
        stock: item.stock,
        shares: item.shares,
        averagePrice: item.averagePrice,
        currentPrice,
        previousClose,
        status: live?.status ?? (jobResult && item.stock.ticker === "RGTI" ? statusFromScore(jobResult.aiMarketScore) : item.status),
        memo: live ? `Data Freshness: ${live.dataFreshness}` : item.memo,
        market: isJapaneseTicker(item.stock.ticker) ? "jp" : "us",
        score: live?.aiMarketScore ?? (item.stock.ticker === "RGTI" && jobResult ? jobResult.aiMarketScore : undefined),
        source: live ? "AI Job" : "Local default",
        fetchedAt: live?.dataFreshness
      };
    });
}

export function mergeVisibleWatchItems(customItems: CustomWatchItem[], removedTickers: string[], jobResult: AiJobResult | null) {
  const map = new Map<string, CustomWatchItem>();
  buildDefaultCustomItems(removedTickers, jobResult).forEach((item) => map.set(item.stock.ticker, item));
  customItems.forEach((item) => {
    if (!removedTickers.includes(item.stock.ticker)) map.set(item.stock.ticker, item);
  });
  return [...map.values()].sort((a, b) => a.stock.ticker.localeCompare(b.stock.ticker));
}

export function needsRealtimeRefresh(item: CustomWatchItem) {
  if (!Number.isFinite(item.currentPrice) || item.currentPrice <= 0) return true;
  if (!item.fetchedAt) return true;
  if (item.source === "Local default" || item.source === "AI Job") return true;
  const fetchedAt = Date.parse(item.fetchedAt);
  if (!Number.isFinite(fetchedAt)) return true;
  return Date.now() - fetchedAt > 15 * 60 * 1000;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}
