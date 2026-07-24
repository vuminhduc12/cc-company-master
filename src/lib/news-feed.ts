import { newsIdentity } from "@/lib/use-ai-job-result";
import type { NewsItem, WatchStatus, WatchlistItem } from "@/types";

export const NEWS_FEED_POLL_MS = 5 * 60 * 1000;
export const NEWS_FEED_STALE_MS = 6 * 60 * 60 * 1000;
export const NEWS_API_CRON_LIMIT = 10;

/** Prefer newer publishedAt when identity collides; earlier layers win ties. */
export function mergeNewsSources(...layers: NewsItem[][]) {
  const byKey = new Map<string, NewsItem>();
  for (const layer of layers) {
    for (const item of layer) {
      const key = newsIdentity(item);
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, item);
        continue;
      }
      const nextTime = Date.parse(item.publishedAt);
      const prevTime = Date.parse(existing.publishedAt);
      if (Number.isFinite(nextTime) && Number.isFinite(prevTime) && nextTime > prevTime) {
        byKey.set(key, item);
      }
    }
  }
  return [...byKey.values()].sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt));
}

export function uniqueNewsItems(items: NewsItem[]) {
  return mergeNewsSources(items);
}

export function latestNewsDate(items: { publishedAt: string }[]) {
  return items.reduce((latest, item) => {
    if (!item.publishedAt) return latest;
    if (!latest) return item.publishedAt;
    return Date.parse(item.publishedAt) > Date.parse(latest) ? item.publishedAt : latest;
  }, "");
}

export function newsForTicker(items: NewsItem[], ticker: string) {
  const normalized = ticker.trim().toUpperCase();
  return items.filter((item) => item.ticker.trim().toUpperCase() === normalized);
}

export function minimalWatchlistItems(tickers: string[]): WatchlistItem[] {
  return [...new Set(tickers.map((ticker) => ticker.trim().toUpperCase()).filter(Boolean))].map((ticker) => ({
    stock: {
      ticker,
      companyName: ticker.replace(/\.T$/, ""),
      exchange: ticker.endsWith(".T") ? "TSE" : "NASDAQ",
      sector: ""
    },
    shares: 0,
    averagePrice: 0,
    currentPrice: 0,
    previousClose: 0,
    status: "Hold" as WatchStatus,
    memo: ""
  }));
}

export function resolveNewsQualitySource(options: {
  autoFeedSource?: string;
  hasAiJobNews?: boolean;
  hasHistoryNews?: boolean;
}) {
  if (options.autoFeedSource && options.autoFeedSource !== "未取得") return options.autoFeedSource;
  if (options.hasAiJobNews) return "AI Job analyzed news";
  if (options.hasHistoryNews) return "History API news";
  return "Local news";
}

export function isNewsCacheStale(fetchedAt: string | null | undefined, staleMs = NEWS_FEED_STALE_MS) {
  if (!fetchedAt) return true;
  const time = Date.parse(fetchedAt);
  if (!Number.isFinite(time)) return true;
  return Date.now() - time > staleMs;
}

export function buildNewsFeedSource(sources: string[]) {
  const unique = [...new Set(sources.map((source) => source.trim()).filter(Boolean))];
  if (!unique.length) return "未取得";
  return unique.join(" + ");
}

/** System ingest time drives "freshness" of the feed, not article publish dates. */
export function resolveNewsFetchedAt(options: {
  feedFetchedAt?: string | null;
  fallbackPublishedAt?: string | null;
}) {
  return options.feedFetchedAt || options.fallbackPublishedAt || null;
}
