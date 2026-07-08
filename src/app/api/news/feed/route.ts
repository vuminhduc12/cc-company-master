import { NextRequest, NextResponse } from "next/server";
import { scanIrNewsForWatchlist } from "@/lib/ir-news";
import { fetchNewsFromNewsApi } from "@/lib/news-api";
import {
  buildNewsFeedSource,
  isNewsCacheStale,
  mergeNewsSources,
  minimalWatchlistItems,
  NEWS_FEED_STALE_MS,
  uniqueNewsItems
} from "@/lib/news-feed";
import { loadNewsCacheMeta, loadRecentSavedNewsForTickers, saveNewsItems } from "@/lib/supabase";
import type { NewsItem } from "@/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const tickers = (request.nextUrl.searchParams.get("tickers") ?? "")
    .split(",")
    .map((ticker) => ticker.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 100);
  const focus = (request.nextUrl.searchParams.get("focus") ?? "").trim().toUpperCase();
  const forceRefresh = request.nextUrl.searchParams.get("refresh") === "1";

  if (!tickers.length) {
    return NextResponse.json({ ok: true, news: [], source: "未取得", fetchedAt: new Date().toISOString(), mode: "cached" as const });
  }

  try {
    let news = await loadRecentSavedNewsForTickers(tickers, 80);
    const cacheMeta = await loadNewsCacheMeta(tickers);
    let fetchedAt = cacheMeta.latestFetchedAt ?? new Date().toISOString();
    let mode: "cached" | "live-scan" = "cached";
    const warnings: string[] = [];
    const sources = new Set<string>();

    if (news.length) sources.add("SEC EDGAR / TDnet");

    const shouldScan = forceRefresh || isNewsCacheStale(cacheMeta.latestFetchedAt, NEWS_FEED_STALE_MS) || !news.length;
    if (shouldScan) {
      const scanResult = await scanIrNewsForWatchlist(minimalWatchlistItems(tickers));
      if (scanResult.news.length) {
        const saveResult = await saveNewsItems(scanResult.news);
        if (saveResult.reason) warnings.push(saveResult.reason);
        news = await loadRecentSavedNewsForTickers(tickers, 80);
        fetchedAt = new Date().toISOString();
        mode = "live-scan";
        sources.add("SEC EDGAR / TDnet");
      } else if (scanResult.errors.length) {
        warnings.push(...scanResult.errors.slice(0, 2));
      }
    }

    const focusTicker = focus && tickers.includes(focus) ? focus : tickers[0];
    const focusNews = news.filter((item) => item.ticker.toUpperCase() === focusTicker);
    const shouldFetchNewsApi = focusTicker && !focusTicker.endsWith(".T") && focusNews.length < 3;
    let supplementalNews: NewsItem[] = [];

    if (shouldFetchNewsApi) {
      try {
        const newsApiResult = await fetchNewsFromNewsApi({
          ticker: focusTicker,
          companyName: focusTicker,
          exchange: "NASDAQ",
          sector: ""
        });
        supplementalNews = newsApiResult.news;
        if (newsApiResult.warning) warnings.push(newsApiResult.warning);
        if (newsApiResult.news.length) {
          sources.add(newsApiResult.source);
          if (newsApiResult.mode === "live") {
            fetchedAt = newsApiResult.fetchedAt;
            mode = "live-scan";
          }
        }
      } catch (error) {
        warnings.push(error instanceof Error ? error.message : "NewsAPI fetch failed");
      }
    }

    const mergedNews = uniqueNewsItems(mergeNewsSources(news, supplementalNews));
    return NextResponse.json({
      ok: true,
      news: mergedNews,
      source: buildNewsFeedSource([...sources]),
      fetchedAt,
      mode,
      scanned: shouldScan,
      cacheCount: cacheMeta.count,
      warning: warnings.length ? warnings.join(" ") : undefined
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 500 }
    );
  }
}
