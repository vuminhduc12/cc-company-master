import { isJapaneseStockTicker, toJQuantsStockCode } from "@/lib/jp-ticker";
import { news as localNews } from "@/lib/mock-data";
import type { NewsItem, Stock } from "@/types";

export type TheNewsApiFetchResult = {
  news: NewsItem[];
  source: string;
  fetchedAt: string;
  mode: "live" | "fallback";
  warning?: string;
};

type TheNewsApiArticle = {
  uuid?: string;
  title?: string;
  description?: string | null;
  snippet?: string | null;
  url?: string;
  language?: string;
  published_at?: string;
  source?: string;
  locale?: string | null;
  categories?: string[];
};

type TheNewsApiPayload = {
  data?: TheNewsApiArticle[];
  error?: {
    code?: string;
    message?: string;
  };
};

export function canFetchJapaneseGeneralNews(stock: Stock) {
  return isJapaneseStockTicker(stock.ticker) || stock.exchange.toUpperCase() === "TSE";
}

export async function fetchJapaneseNewsFromTheNewsApi(stock: Stock): Promise<TheNewsApiFetchResult> {
  const ticker = stock.ticker.trim().toUpperCase();
  const fallback = localNews.filter((item) => item.ticker.toUpperCase() === ticker);
  const fetchedAt = new Date().toISOString();

  if (!canFetchJapaneseGeneralNews(stock)) {
    return {
      news: fallback,
      source: "Local news",
      fetchedAt,
      mode: "fallback",
      warning: "日本株ではないため、日本語ニュース取得をスキップしました。"
    };
  }

  if (!process.env.THE_NEWS_API_KEY) {
    return {
      news: fallback,
      source: "Local news",
      fetchedAt,
      mode: "fallback",
      warning: "THE_NEWS_API_KEYが未設定のため、日本語一般ニュースを取得していません。TDnetとローカルニュースのみ表示します。"
    };
  }

  const params = new URLSearchParams({
    api_token: process.env.THE_NEWS_API_KEY,
    search: buildJapaneseStockNewsSearch(stock),
    language: "ja",
    locale: "jp",
    categories: "business",
    published_after: new Date(Date.now() - 21 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    sort: "published_at",
    limit: "10"
  });
  const domains = process.env.THE_NEWS_API_JP_DOMAINS?.trim();
  if (domains) params.set("domains", domains);

  const response = await fetch(`https://api.thenewsapi.com/v1/news/all?${params.toString()}`, {
    next: { revalidate: 0 }
  });
  if (!response.ok) {
    return {
      news: fallback,
      source: "Local news",
      fetchedAt,
      mode: "fallback",
      warning: `The News APIの日本語ニュース取得に失敗しました (${response.status})。TDnetまたはローカルニュースを表示します。`
    };
  }

  const payload = await response.json() as TheNewsApiPayload;
  if (payload.error) {
    return {
      news: fallback,
      source: "Local news",
      fetchedAt,
      mode: "fallback",
      warning: `The News APIエラー: ${payload.error.message ?? payload.error.code ?? "unknown error"}`
    };
  }

  const seen = new Set<string>();
  const news: NewsItem[] = (payload.data ?? [])
    .filter((article) => {
      const key = article.uuid ?? `${article.title ?? ""}-${article.source ?? ""}`;
      if (!article.title || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 6)
    .map((article) => ({
      title: article.title ?? `${ticker} news`,
      url: article.url,
      source: article.source ? `The News API / ${article.source}` : "The News API",
      publishedAt: article.published_at ?? fetchedAt,
      ticker,
      summary: article.description ?? article.snippet ?? "日本語ニュースの要約を取得できませんでした。",
      sentiment: "Neutral",
      impactScore: 5,
      risk: "詳細診断で確認",
      opportunity: "詳細診断で確認",
      aiComment: "The News APIから取得した日本語の一般ニュースです。投資判断ではなく、材料確認用の参考情報です。"
    }));

  return {
    news: news.length ? news : fallback,
    source: "The News API",
    fetchedAt,
    mode: news.length ? "live" : "fallback",
    warning: news.length ? undefined : "The News APIで該当する日本語ニュースが見つからなかったため、TDnetまたはローカルニュースを表示します。"
  };
}

function buildJapaneseStockNewsSearch(stock: Stock) {
  const code = toJQuantsStockCode(stock.ticker);
  const companyName = stock.companyName.trim();
  const terms = [companyName && companyName !== stock.ticker ? `"${companyName}"` : "", code ? `"${code}"` : ""]
    .filter(Boolean);
  const identity = terms.length ? `(${terms.join(" | ")})` : `"${stock.ticker}"`;
  return `${identity} + (決算 | 業績 | 株価 | 増資 | 配当 | 提携 | 契約 | 自社株 | 上方修正 | 下方修正)`;
}
