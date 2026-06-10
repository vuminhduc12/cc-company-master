import { NextResponse } from "next/server";
import { news as localNews } from "@/lib/mock-data";
import type { NewsItem, Stock } from "@/types";

export const dynamic = "force-dynamic";

type RequestBody = {
  stock?: Stock;
  ticker?: string;
};

export async function POST(request: Request) {
  try {
    const body = await request.json() as RequestBody;
    const ticker = (body.stock?.ticker ?? body.ticker ?? "").toUpperCase();
    if (!ticker) {
      return NextResponse.json({ ok: false, error: "ticker is required" }, { status: 400 });
    }

    const fallback = localNews.filter((item) => item.ticker.toUpperCase() === ticker);
    if (!process.env.NEWS_API_KEY) {
      return NextResponse.json({
        ok: true,
        mode: "fallback",
        source: "Local news",
        fetchedAt: new Date().toISOString(),
        news: fallback,
        warning: "NEWS_API_KEYが未設定のため、ローカルニュースを表示しています。"
      });
    }

    const stock = body.stock ?? { ticker, companyName: ticker, exchange: "", sector: "" };
    const from = new Date(Date.now() - 21 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const query = `("${stock.companyName}" OR ${ticker} OR "${ticker} stock") AND (stock OR shares OR earnings OR partnership OR contract OR offering OR analyst OR revenue OR launch)`;
    const params = new URLSearchParams({
      q: query,
      language: "en",
      pageSize: "10",
      sortBy: "publishedAt",
      from,
      apiKey: process.env.NEWS_API_KEY
    });
    const response = await fetch(`https://newsapi.org/v2/everything?${params.toString()}`, { next: { revalidate: 0 } });
    if (!response.ok) {
      return NextResponse.json({
        ok: true,
        mode: "fallback",
        source: "Local news",
        fetchedAt: new Date().toISOString(),
        news: fallback,
        warning: `NewsAPIの取得に失敗しました (${response.status})。ローカルニュースを表示しています。`
      });
    }

    const payload = await response.json() as {
      articles?: Array<{
        title?: string;
        url?: string;
        source?: { name?: string };
        publishedAt?: string;
        description?: string;
        content?: string;
      }>;
    };
    const seen = new Set<string>();
    const news: NewsItem[] = (payload.articles ?? []).filter((article) => {
      const key = `${article.title ?? ""}-${article.source?.name ?? ""}`;
      if (!article.title || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 6).map((article) => ({
      title: article.title ?? `${ticker} news`,
      url: article.url,
      source: article.source?.name ?? "NewsAPI",
      publishedAt: article.publishedAt ?? new Date().toISOString(),
      ticker,
      summary: article.description ?? article.content ?? "ニュース要約を取得できませんでした。",
      sentiment: "Neutral",
      impactScore: 5,
      risk: "詳細診断で確認",
      opportunity: "詳細診断で確認",
      aiComment: "NewsAPIから取得した最新ニュースです。"
    }));

    return NextResponse.json({
      ok: true,
      mode: "live",
      source: "NewsAPI",
      fetchedAt: new Date().toISOString(),
      news: news.length ? news : fallback,
      warning: news.length ? undefined : "NewsAPIで該当ニュースが見つからなかったため、ローカルニュースを表示しています。"
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 500 }
    );
  }
}
