import { news as localNews } from "@/lib/mock-data";
import type { NewsItem, Stock } from "@/types";

export type NewsApiFetchResult = {
  news: NewsItem[];
  source: string;
  fetchedAt: string;
  mode: "live" | "fallback";
  warning?: string;
};

export async function fetchNewsFromNewsApi(stock: Stock): Promise<NewsApiFetchResult> {
  const ticker = stock.ticker.trim().toUpperCase();
  const fallback = localNews.filter((item) => item.ticker.toUpperCase() === ticker);
  const fetchedAt = new Date().toISOString();

  if (!process.env.NEWS_API_KEY) {
    return {
      news: fallback,
      source: "Local news",
      fetchedAt,
      mode: "fallback",
      warning: "NEWS_API_KEYが未設定のため、ローカルニュースを表示しています。"
    };
  }

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
    return {
      news: fallback,
      source: "Local news",
      fetchedAt,
      mode: "fallback",
      warning: `NewsAPIの取得に失敗しました (${response.status})。ローカルニュースを表示しています。`
    };
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
    publishedAt: article.publishedAt ?? fetchedAt,
    ticker,
    summary: article.description ?? article.content ?? "ニュース要約を取得できませんでした。",
    sentiment: "Neutral",
    impactScore: 5,
    risk: "詳細診断で確認",
    opportunity: "詳細診断で確認",
    aiComment: "NewsAPIから取得した最新ニュースです。"
  }));

  return {
    news: news.length ? news : fallback,
    source: "NewsAPI",
    fetchedAt,
    mode: news.length ? "live" : "fallback",
    warning: news.length ? undefined : "NewsAPIで該当ニュースが見つからなかったため、ローカルニュースを表示しています。"
  };
}
