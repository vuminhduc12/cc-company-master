import { NextRequest, NextResponse } from "next/server";
import { scanIrNewsForWatchlist } from "@/lib/ir-news";
import { fetchNewsFromNewsApi } from "@/lib/news-api";
import { NEWS_API_CRON_LIMIT } from "@/lib/news-feed";
import { loadServerWatchlistItems } from "@/lib/server-watchlist";
import { saveNewsFeedRunMeta, saveNewsItems } from "@/lib/supabase";
import type { NewsItem, WatchlistItem } from "@/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  return runIrNewsScan(request);
}

export async function POST(request: NextRequest) {
  return runIrNewsScan(request);
}

async function runIrNewsScan(request: NextRequest) {
  const authError = authorize(request);
  if (authError) return authError;

  try {
    const watchlist = await loadServerWatchlistItems();
    const irResult = await scanIrNewsForWatchlist(watchlist.items);
    const newsApiResult = await fetchSupplementalNewsApi(watchlist.items);
    const combinedNews = [...irResult.news, ...newsApiResult.news];
    const saveResult = await saveNewsItems(combinedNews);
    const ranAt = new Date().toISOString();
    await saveNewsFeedRunMeta({
      ranAt,
      found: combinedNews.length,
      scanned: irResult.scanned,
      failed: irResult.failed + newsApiResult.failed
    });

    return NextResponse.json({
      ok: true,
      scanned: irResult.scanned,
      found: combinedNews.length,
      irFound: irResult.news.length,
      newsApiFound: newsApiResult.news.length,
      saved: saveResult.saved,
      savedCount: saveResult.count ?? 0,
      failed: irResult.failed + newsApiResult.failed,
      errors: [...irResult.errors, ...newsApiResult.errors].length
        ? [...irResult.errors, ...newsApiResult.errors]
        : undefined,
      runAt: ranAt
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error"
    }, { status: 500 });
  }
}

async function fetchSupplementalNewsApi(items: WatchlistItem[]) {
  const usTargets = items
    .filter((item) => !item.stock.ticker.endsWith(".T") && item.stock.exchange !== "TSE")
    .slice(0, NEWS_API_CRON_LIMIT);

  if (!usTargets.length || !process.env.NEWS_API_KEY) {
    return { news: [] as NewsItem[], failed: 0, errors: [] as string[] };
  }

  const news: NewsItem[] = [];
  const errors: string[] = [];
  let failed = 0;

  for (const item of usTargets) {
    try {
      const result = await fetchNewsFromNewsApi(item.stock);
      if (result.mode === "live") {
        news.push(...result.news.map((entry) => ({
          ...entry,
          source: entry.source === "NewsAPI" || entry.source.includes("NewsAPI")
            ? entry.source
            : `NewsAPI / ${entry.source}`
        })));
      }
      if (result.warning && result.mode === "fallback") {
        // Keep cron quiet for missing local fallbacks; only surface hard failures.
      }
    } catch (error) {
      failed++;
      errors.push(`${item.stock.ticker} NewsAPI: ${error instanceof Error ? error.message : "failed"}`);
    }
  }

  return { news, failed, errors };
}

function authorize(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV !== "production") return null;
    return NextResponse.json({ ok: false, error: "CRON_SECRET is not configured." }, { status: 401 });
  }
  const bearer = request.headers.get("authorization")?.replace("Bearer ", "");
  const manual = request.headers.get("x-cron-secret");
  if (bearer === secret || manual === secret) return null;
  return NextResponse.json({ ok: false, error: "Invalid CRON_SECRET." }, { status: 401 });
}
