import { NextRequest, NextResponse } from "next/server";
import { buildNewsFeedSource, uniqueNewsItems } from "@/lib/news-feed";
import { loadNewsCacheMeta, loadNewsFeedRunMeta, loadRecentSavedNewsForTickers } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * Read-only news feed for the UI.
 * Heavy SEC/TDnet/NewsAPI ingestion belongs to /api/cron/ir-news only.
 */
export async function GET(request: NextRequest) {
  const tickers = (request.nextUrl.searchParams.get("tickers") ?? "")
    .split(",")
    .map((ticker) => ticker.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 100);

  if (!tickers.length) {
    return NextResponse.json({
      ok: true,
      news: [],
      source: "未取得",
      fetchedAt: new Date().toISOString(),
      mode: "cached" as const
    });
  }

  try {
    const [news, cacheMeta, runMeta] = await Promise.all([
      loadRecentSavedNewsForTickers(tickers, 80),
      loadNewsCacheMeta(tickers),
      loadNewsFeedRunMeta()
    ]);

    const sources = new Set<string>();
    for (const item of news) {
      if (item.source === "SEC EDGAR" || item.source === "TDnet") sources.add("SEC EDGAR / TDnet");
      else if (item.source === "NewsAPI" || item.source?.includes("NewsAPI")) sources.add("NewsAPI");
      else if (item.source) sources.add(item.source);
    }

    const fetchedAt = runMeta?.ranAt ?? cacheMeta.latestFetchedAt ?? new Date().toISOString();
    const warning = !news.length
      ? "保存済みニュースがありません。cron の IR ニュース取得後に更新されます。"
      : undefined;

    return NextResponse.json({
      ok: true,
      news: uniqueNewsItems(news),
      source: buildNewsFeedSource([...sources]),
      fetchedAt,
      mode: "cached" as const,
      cacheCount: cacheMeta.count,
      lastCronAt: runMeta?.ranAt ?? null,
      warning
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 500 }
    );
  }
}
