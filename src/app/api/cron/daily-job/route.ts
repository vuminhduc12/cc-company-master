import { NextRequest, NextResponse } from "next/server";
import { aiLoginRequired, callOpenAiChatWithUsageGuard, recordAiCacheHit, reserveAiUsage, resolveAiUserFromRequest } from "@/lib/ai-usage";
import { getPricesForTicker, news as mockNews, prices, report as mockReport } from "@/lib/mock-data";
import { buildOpenAiCacheKey, getOpenAiCache, setOpenAiCache } from "@/lib/openai-cache";
import { analyzeStock, scoreStock, statusFromScore } from "@/lib/scoring";
import { loadServerWatchlistItems } from "@/lib/server-watchlist";
import { fetchStockData } from "@/lib/stock-data";
import { loadSavedNewsForTicker, saveJobResult } from "@/lib/supabase";
import { getUserPlan } from "@/lib/user-plan";
import type { AiJobExecutionAudit, AiJobResult, AiStockExecutionAudit, AiTask, DailyPrice, NewsItem, Sentiment, Stock, StockAnalysisResult } from "@/types";

const jstFormatter = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit"
});
const newsAnalysisCacheTtlMs = 24 * 60 * 60 * 1000;

export async function GET(request: NextRequest) {
  return runDailyJob(request, "cron");
}

export async function POST(request: NextRequest) {
  return runDailyJob(request, "manual");
}

async function runDailyJob(request: NextRequest, source: "cron" | "manual") {
  const authError = authorize(request, source);
  if (authError) return authError;

  const hasAiKeys = Boolean(process.env.OPENAI_API_KEY && process.env.NEWS_API_KEY);
  if (source === "cron" && !hasAiKeys) {
    return NextResponse.json(
      buildErrorResult("AI/news API keys are not configured. Cron job skipped.", "OPENAI_API_KEYまたはNEWS_API_KEY未設定のため自動実行をスキップしました。株価はYahoo Finance優先で取得するためSTOCK_API_KEYは任意です。"),
      { status: 412 }
    );
  }

  try {
    const aiUser = await resolveAiUserFromRequest(request);
    const aiUserId = aiUser.id;
    if (source === "manual" && aiLoginRequired(aiUserId)) {
      return NextResponse.json(
        buildErrorResult("Login is required for manual AI Job.", "本番環境の手動AI Jobはログインが必要です。スマホでログインし直してから再実行してください。"),
        { status: 401 }
      );
    }
    const userPlan = await getUserPlan(aiUserId, aiUser.email);
    const lastRun = nowJst();
    const nextRun = nextRunJst();
    const manualStocks = source === "manual" ? await parseManualStocks(request) : [];
    const serverWatchlist = manualStocks.length ? null : await loadServerWatchlistItems();
    const targets = manualStocks.length
      ? manualStocks.map((stock) => ({
        stock,
        shares: 0,
        averagePrice: 0,
        currentPrice: 0,
        previousClose: 0,
        status: "Watch" as const,
        memo: "Manual AI Jobで指定された追加銘柄"
      }))
      : serverWatchlist?.items ?? [];
    if (targets.length === 0) {
      return NextResponse.json(
        buildErrorResult("No watchlist targets found.", "Supabase watchlist_itemsに自動分析対象の銘柄がありません。Watchlist画面で銘柄を追加してください。"),
        { status: 412 }
      );
    }
    if (source === "manual" && targets.length > userPlan.watchlistItems) {
      return NextResponse.json(
        buildErrorResult(`${userPlan.name} plan allows up to ${userPlan.watchlistItems} watchlist stocks.`),
        { status: 403 }
      );
    }
    if (hasAiKeys) {
      const usageReservation = await reserveAiUsage({
        feature: "daily_news_job",
        userId: aiUserId,
        userEmail: aiUser.email,
        model: "gpt-4o-mini",
        promptVersion: "daily-news-job-v1"
      });
      if (!usageReservation.allowed) {
        return NextResponse.json(
          buildErrorResult(usageReservation.reason ?? "AI usage limit exceeded.", usageReservation.reason),
          { status: 429 }
        );
      }
    }
    const stockResults: StockAnalysisResult[] = [];
    for (const item of targets) {
      stockResults.push(await buildStockAnalysis(item.stock, hasAiKeys, aiUserId, aiUser.email));
    }
    const successfulResults = stockResults.filter((item) => !item.error);
    if (successfulResults.length === 0) {
      throw new Error(stockResults.map((item) => `${item.stock.ticker}: ${item.error ?? "No data"}`).join(" / "));
    }

    const primary = successfulResults[0];
    const allNews = successfulResults.flatMap((item) => item.news);
    const aiMarketScore = Math.round(successfulResults.reduce((sum, item) => sum + item.aiMarketScore, 0) / successfulResults.length);
    const latest = primary.price;
    const tasks = buildTasks(lastRun, nextRun, successfulResults, stockResults);
    const executionAudit = buildExecutionAudit(stockResults, lastRun, hasAiKeys);
    const result: AiJobResult = {
      ok: true,
      mode: successfulResults.every((item) => item.warning?.includes("ローカル履歴データ")) ? "mock" : "live",
      status: stockResults.some((item) => item.error) ? "Error" : "Completed",
      lastRun,
      nextRun,
      dataFreshness: latest.date,
      aiMarketScore,
      price: latest,
      news: allNews,
      stocks: stockResults,
      executionAudit,
      tasks,
      report: buildPortfolioReport(successfulResults, aiMarketScore, nextRun),
      warning: buildWarning(hasAiKeys, stockResults, executionAudit)
    };
    if (serverWatchlist?.warning) {
      result.warning = result.warning ? `${result.warning} ${serverWatchlist.warning}` : serverWatchlist.warning;
    }
    const saveResult = await saveJobResult(result);
    if (!saveResult.saved && saveResult.reason) {
      result.warning = result.warning ? `${result.warning} ${saveResult.reason}` : saveResult.reason;
    }
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const result = buildErrorResult(message);
    try {
      await saveJobResult(result);
    } catch {
      return NextResponse.json(result, { status: 500 });
    }
    return NextResponse.json(result, { status: 500 });
  }
}

async function parseManualStocks(request: NextRequest): Promise<Stock[]> {
  const body = await request.json().catch(() => ({})) as { watchlist?: Stock[] };
  if (!Array.isArray(body.watchlist)) return [];

  const seen = new Set<string>();
  return body.watchlist.filter((stock): stock is Stock => {
    if (!stock || typeof stock !== "object") return false;
    const ticker = String(stock.ticker ?? "").trim().toUpperCase();
    if (!ticker || seen.has(ticker) || !/^[A-Z0-9.-]{1,12}$/.test(ticker)) return false;
    seen.add(ticker);
    stock.ticker = ticker;
    stock.companyName = String(stock.companyName ?? ticker);
    stock.sector = String(stock.sector ?? "Unknown");
    stock.exchange = String(stock.exchange ?? "NASDAQ/NYSE");
    return true;
  }).slice(0, 20);
}

function authorize(request: NextRequest, source: "cron" | "manual") {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    if (source === "manual" && process.env.NODE_ENV !== "production") return null;
    return NextResponse.json(buildErrorResult("CRON_SECRET is not configured."), { status: 401 });
  }

  const bearer = request.headers.get("authorization")?.replace("Bearer ", "");
  const manualSecret = request.headers.get("x-cron-secret");
  if (bearer === secret || manualSecret === secret) return null;

  return NextResponse.json(buildErrorResult("Invalid CRON_SECRET."), { status: 401 });
}

async function buildStockAnalysis(stock: Stock, hasAiKeys: boolean, aiUserId: string, aiUserEmail: string | null): Promise<StockAnalysisResult> {
  try {
    const stockData = await fetchStockData(stock.ticker);
    const priceData = stockData.prices;
    const latest = priceData[priceData.length - 1];
    if (!latest) throw new Error("No price data available.");
    const rawNews = await fetchNews(stock);
    const analyzedNews = await analyzeNews(rawNews, latest, stock, aiUserId, aiUserEmail);
    const scoreAnalysis = analyzeStock(latest, analyzedNews);
    const aiMarketScore = scoreAnalysis.score;
    const status = statusFromScore(aiMarketScore);
    return {
      stock,
      price: latest,
      prices: priceData,
      news: analyzedNews,
      aiMarketScore,
      status,
      dataFreshness: latest.date,
      report: {
        date: latest.date,
        market: buildMarketSummary(stock.ticker, latest),
        watchlist: `${stock.ticker}は${status}判定です。${scoreAnalysis.summary}`,
        news: buildNewsSummary(analyzedNews),
        decision: buildDecision(stock.ticker, aiMarketScore, latest, analyzedNews),
        tomorrow: buildTomorrowStrategy(stock.ticker, latest)
      },
      warning: stockData.warning
    };
  } catch (error) {
    const fallbackPrices = getPricesForTicker(stock.ticker);
    const fallbackPrice = fallbackPrices?.[fallbackPrices.length - 1] ?? prices[prices.length - 1];
    const fallbackNews = hasAiKeys ? [] : mockNews.filter((item) => item.ticker === stock.ticker || stock.ticker === "RGTI");
    const message = error instanceof Error ? error.message : "Unknown error";
    return {
      stock,
      price: fallbackPrice,
      prices: fallbackPrices ?? [fallbackPrice],
      news: fallbackNews,
      aiMarketScore: scoreStock(fallbackPrice, fallbackNews),
      status: "Caution",
      dataFreshness: fallbackPrice.date,
      report: {
        date: fallbackPrice.date,
        market: `${stock.ticker}の最新データ取得に失敗しました。`,
        watchlist: `${stock.ticker}: ${message}`,
        news: "ニュース分析は未更新です。",
        decision: "エラーのため、前回データまたはダミーデータを表示しています。",
        tomorrow: "APIキー、API制限、ティッカー、Supabase保存状態を確認してください。"
      },
      error: message
    };
  }
}

async function fetchNews(stock: Stock): Promise<NewsItem[]> {
  const key = process.env.NEWS_API_KEY;
  const ticker = stock.ticker;
  const savedNews = await loadSavedNewsForTicker(ticker);
  const localNews = mockNews.filter((item) => item.ticker === ticker || ticker === "RGTI");
  if (!key) return savedNews.length ? savedNews : localNews;

  const from = new Date(Date.now() - 21 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const query = `("${stock.companyName}" OR ${ticker} OR "${stock.exchange}:${ticker}" OR "${ticker} stock") AND (stock OR shares OR earnings OR partnership OR contract OR offering OR analyst OR revenue OR launch)`;
  const params = new URLSearchParams({
    q: query,
    language: "en",
    pageSize: "10",
    sortBy: "publishedAt",
    from,
    apiKey: key
  });
  const url = `https://newsapi.org/v2/everything?${params.toString()}`;
  const response = await fetch(url, { next: { revalidate: 0 } }).catch((error) => {
    const message = error instanceof Error ? error.message : "Unknown error";
    return {
      ok: false,
      status: 0,
      json: async () => ({ articles: [], error: message })
    } as Response;
  });
  if (!response.ok) {
    if (savedNews.length) return savedNews;
    if (localNews.length) return localNews.map((item) => ({
      ...item,
      ticker,
      aiComment: `News API error ${response.status}のため、保存済みまたはローカルニュースを使った簡易分析に切り替えました。`
    }));
    return [];
  }

  const payload = await response.json() as { articles?: Array<{ title?: string; url?: string; source?: { name?: string }; publishedAt?: string; description?: string; content?: string }> };
  const seen = new Set<string>();
  const newsItems: NewsItem[] = (payload.articles ?? []).filter((article) => {
    const key = `${article.title ?? ""}-${article.source?.name ?? ""}`;
    if (!article.title || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 6).map((article) => ({
    title: article.title ?? `${ticker}のニュース`,
    url: article.url,
    source: article.source?.name ?? "News API",
    publishedAt: (article.publishedAt ?? new Date().toISOString()).slice(0, 10),
    ticker,
    summary: article.description ?? article.content ?? "説明文は取得できませんでした。",
    sentiment: "Neutral" as const,
    impactScore: 5,
    risk: "AI分析待ち",
    opportunity: "AI分析待ち",
    aiComment: "OpenAIで日本語分析します。"
  }));
  if (newsItems.length) return newsItems;
  if (savedNews.length) return savedNews;
  return localNews.map((item) => ({
    ...item,
    ticker,
    aiComment: "News APIで新しい記事が見つからなかったため、ローカルニュースを使った簡易分析に切り替えました。"
  }));
}

async function analyzeNews(items: NewsItem[], price: DailyPrice, stock: Stock, aiUserId: string, aiUserEmail: string | null): Promise<NewsItem[]> {
  return Promise.all(items.map(async (item) => {
    const analysis = await analyzeOneNews(item, price, stock, aiUserId, aiUserEmail).catch((error) => {
      const fallback = ruleBasedAnalysis(item, price);
      const message = error instanceof Error ? error.message : "Unknown error";
      return {
        ...fallback,
        aiComment: `${fallback.aiComment} OpenAI分析中にエラーが発生したため、ルールベース分析に切り替えました。${message}`
      };
    });
    return {
      ...item,
      sentiment: analysis.sentiment,
      impactScore: analysis.impactScore,
      risk: analysis.riskPoints.join(" / ") || item.risk,
      opportunity: analysis.opportunityPoints.join(" / ") || item.opportunity,
      aiComment: analysis.aiComment,
      summary: `要点: ${analysis.plainSummary}\n短期影響: ${analysis.shortTermImpact}\n中期影響: ${analysis.midTermImpact}`
    };
  }));
}

type NewsAnalysis = {
  sentiment: Sentiment;
  impactScore: number;
  plainSummary: string;
  shortTermImpact: string;
  midTermImpact: string;
  riskPoints: string[];
  opportunityPoints: string[];
  aiComment: string;
};

type OpenAiNewsPayload = {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
  error?: {
    message?: string;
    code?: string;
  };
};

async function analyzeOneNews(item: NewsItem, price: DailyPrice, stock: Stock, aiUserId: string, aiUserEmail: string | null) {
  const fallback = ruleBasedAnalysis(item, price);
  const key = process.env.OPENAI_API_KEY;
  if (!key) return fallback;
  const cacheKey = buildOpenAiCacheKey("daily-news-analysis-v1", {
    model: "gpt-4o-mini",
    ticker: stock.ticker,
    title: item.title,
    url: item.url,
    source: item.source,
    publishedAt: item.publishedAt,
    summary: item.summary,
    priceDate: price.date
  });
  const cached = getOpenAiCache<NewsAnalysis>(cacheKey);
  if (cached) {
    await recordAiCacheHit({
      feature: "daily_news_analysis",
      userId: aiUserId,
      ticker: stock.ticker,
      model: "gpt-4o-mini",
      promptVersion: "daily-news-analysis-v1"
    });
    return {
      ...cached,
      aiComment: `${cached.aiComment} 短時間の同一ニュース分析をキャッシュから再利用しました。`
    };
  }

  const prompt = `あなたは日本語で説明する金融ニュース分析AIです。
以下の英語ニュースと株価データを、日本の個人投資家が読みやすい日本語に要約してください。
短期影響・中期影響・リスク・チャンス・総合判断を、必ずJSONだけで返してください。
これは投資助言ではなく分析補助です。売買推奨の断定は禁止です。

ニュース: ${item.title}
URL: ${item.url ?? "なし"}
情報源: ${item.source}
要約: ${item.summary}
銘柄: ${stock.ticker} / ${stock.companyName} / ${stock.exchange}
株価: close=${price.close}, changePercent=${price.changePercent}, rsi=${price.rsi}, volume=${price.volume}

ルール:
- plainSummary は「何が起きたニュースか」を初心者にも分かる日本語で1文
- shortTermImpact, midTermImpact, riskPoints, opportunityPoints, aiComment は必ず自然な日本語
- riskPoints と opportunityPoints は日本語の短い配列
- sentiment は Positive, Neutral, Negative のいずれか
- impactScore は 1〜10
- 専門用語は初心者にも分かる表現にする
- Google Financeのニュース欄のように、海外ニュースの見出しをそのまま訳すだけでなく、${stock.ticker}株価との関係を説明する

返却形式:
{"sentiment":"Positive | Neutral | Negative","impactScore":1,"plainSummary":"","shortTermImpact":"","midTermImpact":"","riskPoints":[],"opportunityPoints":[],"aiComment":""}`;

  const aiResult = await callOpenAiChatWithUsageGuard<OpenAiNewsPayload>({
    feature: "daily_news_analysis",
    userId: aiUserId,
    userEmail: aiUserEmail,
    ticker: stock.ticker,
    model: "gpt-4o-mini",
    promptVersion: "daily-news-analysis-v1",
    estimatedInputTokens: Math.ceil(prompt.length / 4),
    apiKey: key,
    enforceUsageLimit: false,
    successStatus: "api_success",
    body: {
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" }
    }
  });

  if (!aiResult.ok) {
    return {
      ...fallback,
      aiComment: `${fallback.aiComment} ${aiResult.warning ?? "OpenAI APIエラーのため、ルールベース分析に切り替えました。"}`
    };
  }
  const analysis = parseAnalysis(aiResult.payload?.choices?.[0]?.message?.content, fallback);
  setOpenAiCache(cacheKey, analysis, newsAnalysisCacheTtlMs);
  return analysis;
}

function parseAnalysis(content: string | undefined, fallback: NewsAnalysis): NewsAnalysis {
  if (!content) return fallback;
  try {
    const parsed = JSON.parse(content) as Partial<NewsAnalysis>;
    const sentiment: Sentiment = parsed.sentiment === "Positive" || parsed.sentiment === "Negative" || parsed.sentiment === "Neutral" ? parsed.sentiment : fallback.sentiment;
    return {
      sentiment,
      impactScore: clamp(Number(parsed.impactScore ?? fallback.impactScore), 1, 10),
      plainSummary: String(parsed.plainSummary ?? fallback.plainSummary),
      shortTermImpact: String(parsed.shortTermImpact ?? fallback.shortTermImpact),
      midTermImpact: String(parsed.midTermImpact ?? fallback.midTermImpact),
      riskPoints: Array.isArray(parsed.riskPoints) ? parsed.riskPoints.map(String) : fallback.riskPoints,
      opportunityPoints: Array.isArray(parsed.opportunityPoints) ? parsed.opportunityPoints.map(String) : fallback.opportunityPoints,
      aiComment: String(parsed.aiComment ?? fallback.aiComment)
    };
  } catch {
    return { ...fallback, aiComment: `${fallback.aiComment} OpenAIのJSON解析に失敗したため、ルールベース分析を表示しています。` };
  }
}

function ruleBasedAnalysis(item: NewsItem, price: DailyPrice): NewsAnalysis {
  const text = `${item.title} ${item.summary}`.toLowerCase();
  const negative = ["dilution", "offering", "insider sell", "lawsuit", "loss", "希薄化", "増資", "売出し"].some((word) => text.includes(word));
  const positive = ["partnership", "contract", "support", "upgrade", "breakthrough", "上昇", "強気"].some((word) => text.includes(word));
  const sentiment: Sentiment = negative ? "Negative" : positive || price.changePercent > 5 ? "Positive" : "Neutral";
  return {
    sentiment,
    impactScore: sentiment === "Positive" ? 8 : sentiment === "Negative" ? 7 : 5,
    plainSummary: `${item.source}の海外ニュースです。${item.summary}`,
    shortTermImpact: price.rsi > 70 ? "短期では買われすぎ感があり、急な反落に注意が必要です。" : "短期では出来高が続くかを確認する局面です。",
    midTermImpact: "中期では20日移動平均と50日移動平均を上回る状態が続くかが重要です。",
    riskPoints: price.rsi > 70 ? ["RSIが高く短期過熱", "急騰後の利確売り"] : ["出来高が減ると勢いが弱まる可能性"],
    opportunityPoints: price.close > price.ma20 ? ["終値が20日移動平均を上回っている", "資金流入が続けば上昇継続の可能性"] : ["押し目からの反発確認"],
    aiComment: "ニュース本文と株価指標をもとにした日本語の簡易分析です。最終判断は他の材料も確認してください。"
  };
}

function buildTasks(lastRun: string, nextRun: string, successfulResults: StockAnalysisResult[], allResults: StockAnalysisResult[]): AiTask[] {
  const analyzedNews = successfulResults.flatMap((item) => item.news);
  const positiveCount = analyzedNews.filter((item) => item.sentiment === "Positive").length;
  const negativeCount = analyzedNews.filter((item) => item.sentiment === "Negative").length;
  const completedTickers = successfulResults.map((item) => item.stock.ticker).join(", ");
  const failedTickers = allResults.filter((item) => item.error).map((item) => item.stock.ticker);
  const latestLines = successfulResults.map((item) => `${item.stock.ticker} $${item.price.close.toFixed(2)} RSI${item.price.rsi.toFixed(1)}`).join(" / ");
  const riskLines = successfulResults.map((item) => `${item.stock.ticker} $${(item.price.close * 0.92).toFixed(2)}`).join(" / ");
  const strategyLines = successfulResults.map((item) => `${item.stock.ticker}: 利確$${(item.price.close * 1.12).toFixed(2)} 再IN$${item.price.ma20.toFixed(2)}`).join(" / ");
  const status = failedTickers.length > 0 ? "Error" : "Completed";
  const error = failedTickers.length > 0 ? `${failedTickers.join(", ")} の更新に失敗しました。` : undefined;
  return [
    { name: "Data Collector", role: "株価データ取得", task: "Watchlist銘柄の株価、出来高、RSI、MA20、MA50を更新", status, lastRun, nextRun, result: `${completedTickers} を更新。${latestLines}`, error },
    { name: "News Analyst", role: "ニュース分析", task: "銘柄別ニュース取得、要約、感情分析", status, lastRun, nextRun, result: `${completedTickers}: Positive ${positiveCount}件、Negative ${negativeCount}件`, error },
    { name: "Risk Manager", role: "リスク管理", task: "急落、希薄化、出来高減少、損切り注意ライン", status, lastRun, nextRun, result: `損切り注意ライン ${riskLines}`, error },
    { name: "Trade Strategist", role: "短期戦略", task: "エントリー、利確、再エントリー候補", status, lastRun, nextRun, result: strategyLines, error },
    { name: "Report Writer", role: "日次レポート", task: "銘柄別レポート、明日の注意点、総合判断", status, lastRun, nextRun, result: "銘柄別Daily Reportを作成しました。", error }
  ];
}

function buildMarketSummary(ticker: string, price: DailyPrice) {
  const direction = price.changePercent >= 0 ? "上昇" : "下落";
  return `${ticker}は終値$${price.close.toFixed(2)}で、前日比${price.changePercent.toFixed(2)}%の${direction}でした。出来高は約${Math.round(price.volume / 1000000)}M、RSIは${price.rsi.toFixed(2)}です。`;
}

function buildNewsSummary(items: NewsItem[]) {
  if (items.length === 0) return "本日は重要ニュースを取得できませんでした。株価と出来高の変化を中心に確認してください。";
  return items
    .slice(0, 5)
    .map((item, index) => `${index + 1}. ${item.title}（${item.source} / ${item.publishedAt}）\n   判定: ${item.sentiment} / 影響度${item.impactScore}\n   ${item.summary}\n   リスク: ${item.risk}\n   チャンス: ${item.opportunity}`)
    .join("\n");
}

function buildDecision(ticker: string, score: number, price: DailyPrice, news: NewsItem[] = []) {
  const analysis = analyzeStock(price, news);
  const label = score >= 80 ? "Strong Buy寄り" : score >= 65 ? "Buy寄り" : score >= 50 ? "Watch" : score >= 35 ? "Caution" : "Sell/Danger";
  const caution = price.rsi >= 70 ? "ただしRSIが高く、短期の過熱感があります。" : "過熱感は強すぎず、出来高の継続確認が重要です。";
  const positives = analysis.positivePoints.slice(0, 3).map((item) => `${item.label} ${item.points > 0 ? "+" : ""}${item.points}`).join(" / ") || "強材料なし";
  const negatives = analysis.negativePoints.slice(0, 3).map((item) => `${item.label} ${item.points}`).join(" / ") || "大きな弱材料なし";
  return `${ticker}のAI総合スコアは${score}点で、判定は${label}です。${caution}\n強材料: ${positives}\n注意材料: ${negatives}\nこれは売買推奨ではなく、確認すべき材料の整理です。`;
}

function buildTomorrowStrategy(ticker: string, price: DailyPrice) {
  return `${ticker}は、出来高倍率${price.volumeRatio.toFixed(2)}倍、RSI${price.rsi.toFixed(2)}、MA20 $${price.ma20.toFixed(2)}を確認してください。終値がMA20を維持できるか、急騰後に出来高が落ちないかを優先して見ます。`;
}

function buildPortfolioReport(results: StockAnalysisResult[], aiMarketScore: number, nextRun: string) {
  const date = results[0]?.price.date ?? nowJst();
  const summary = results.map((item) => `${item.stock.ticker}: ${item.status} / Score ${item.aiMarketScore} / $${item.price.close.toFixed(2)} / RSI ${item.price.rsi.toFixed(1)}`).join("\n");
  const newsSummary = results.map((item) => `【${item.stock.ticker}】\n${buildNewsSummary(item.news)}`).join("\n\n");
  const decisions = results.map((item) => buildDecision(item.stock.ticker, item.aiMarketScore, item.price, item.news)).join("\n");
  return {
    date,
    market: `Watchlist全体のAI Market Scoreは${aiMarketScore}点です。対象銘柄は${results.map((item) => item.stock.ticker).join(", ")}です。`,
    watchlist: summary,
    news: newsSummary,
    decision: decisions,
    tomorrow: `次回自動実行は${nextRun}です。\n${results.map((item) => buildTomorrowStrategy(item.stock.ticker, item.price)).join("\n")}`
  };
}

function buildExecutionAudit(results: StockAnalysisResult[], lastRun: string, hasAiKeys: boolean): AiJobExecutionAudit {
  const stocks = results.map((item) => buildStockExecutionAudit(item, hasAiKeys));
  const latestNewsDate = latestDate(stocks.map((item) => item.latestNewsDate).filter((value): value is string => Boolean(value)));
  return {
    lastRun,
    generatedAt: new Date().toISOString(),
    totalStocks: stocks.length,
    completedStocks: stocks.filter((item) => item.status !== "Error").length,
    failedStocks: stocks.filter((item) => item.status === "Error").length,
    aiNewsCount: stocks.reduce((sum, item) => sum + item.aiNewsCount, 0),
    ruleNewsCount: stocks.reduce((sum, item) => sum + item.ruleNewsCount, 0),
    latestNewsDate,
    dataFreshness: latestDate(stocks.map((item) => item.priceFreshness)) ?? "",
    stocks
  };
}

function buildStockExecutionAudit(item: StockAnalysisResult, hasAiKeys: boolean): AiStockExecutionAudit {
  const ruleNewsCount = item.news.filter((newsItem) => isRuleBasedNewsAnalysis(newsItem, hasAiKeys)).length;
  const aiNewsCount = Math.max(item.news.length - ruleNewsCount, 0);
  const latestNewsDate = latestDate(item.news.map((newsItem) => newsItem.publishedAt));
  const fallbackReason = buildFallbackReason(item, ruleNewsCount, hasAiKeys);
  return {
    ticker: item.stock.ticker,
    status: item.error ? "Error" : "Completed",
    priceSource: item.price.source || "unknown",
    priceFreshness: item.dataFreshness || item.price.date,
    newsCount: item.news.length,
    latestNewsDate,
    aiNewsCount,
    ruleNewsCount,
    fallbackReason,
    warning: item.warning,
    error: item.error
  };
}

function isRuleBasedNewsAnalysis(item: NewsItem, hasAiKeys: boolean) {
  if (!hasAiKeys) return true;
  const comment = `${item.aiComment} ${item.summary} ${item.risk} ${item.opportunity}`;
  return comment.includes("ルールベース")
    || comment.includes("OpenAIの利用上限")
    || comment.includes("OpenAI API error")
    || comment.includes("OpenAIのJSON解析")
    || comment.includes("簡易分析");
}

function buildFallbackReason(item: StockAnalysisResult, ruleNewsCount: number, hasAiKeys: boolean) {
  if (item.error) return item.error;
  if (!hasAiKeys) return "OPENAI_API_KEYまたはNEWS_API_KEY未設定のため、ニュース分析はルールベースです。";
  const fallbackNews = item.news.find((newsItem) => isRuleBasedNewsAnalysis(newsItem, hasAiKeys));
  if (fallbackNews?.aiComment.includes("利用上限") || fallbackNews?.aiComment.includes("429")) return "OpenAI 429のため、一部ニュースをルールベース分析に切り替えました。";
  if (fallbackNews?.aiComment.includes("OpenAI API error")) return "OpenAI APIエラーのため、一部ニュースをルールベース分析に切り替えました。";
  if (fallbackNews?.aiComment.includes("JSON解析")) return "OpenAI応答のJSON解析に失敗したため、一部ニュースをルールベース分析に切り替えました。";
  if (ruleNewsCount > 0) return "一部ニュースはルールベース分析です。";
  return item.warning;
}

function latestDate(values: string[]) {
  const normalized = values
    .map((value) => value?.trim())
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
  return normalized.at(-1);
}

function buildWarning(hasAiKeys: boolean, results: StockAnalysisResult[], executionAudit?: AiJobExecutionAudit) {
  const warnings = [];
  if (!hasAiKeys) warnings.push("OPENAI_API_KEYまたはNEWS_API_KEY未設定のため、ニュース分析はmock-dataまたはルールベースで実行しました。");
  const ruleFallbacks = executionAudit?.stocks.filter((item) => item.ruleNewsCount > 0 && item.fallbackReason).map((item) => `${item.ticker}: ${item.fallbackReason}`) ?? [];
  warnings.push(...ruleFallbacks);
  const stockWarnings = results.flatMap((item) => item.warning ? [`${item.stock.ticker}: ${item.warning}`] : []);
  warnings.push(...stockWarnings);
  const failed = results.filter((item) => item.error);
  if (failed.length > 0) warnings.push(`一部銘柄の更新に失敗しました: ${failed.map((item) => `${item.stock.ticker} (${item.error})`).join(", ")}`);
  return warnings.length > 0 ? warnings.join(" ") : undefined;
}

function buildErrorResult(error: string, warning?: string): AiJobResult {
  const lastRun = nowJst();
  const nextRun = nextRunJst();
  const latest = prices[prices.length - 1];
  return {
    ok: false,
    mode: "mock",
    status: "Error",
    lastRun,
    nextRun,
    dataFreshness: latest.date,
    aiMarketScore: scoreStock(latest, mockNews),
    price: latest,
    news: mockNews,
    tasks: mockErrorTasks(lastRun, nextRun, error),
    report: mockReport,
    error,
    warning
  };
}

function mockErrorTasks(lastRun: string, nextRun: string, error: string): AiTask[] {
  return ["Data Collector", "News Analyst", "Risk Manager", "Trade Strategist", "Report Writer"].map((name) => ({
    name,
    role: "AI社員タスク",
    task: "Daily Job",
    status: "Error",
    lastRun,
    nextRun,
    result: "実行に失敗しました。",
    error
  }));
}

function clamp(value: number, min: number, max: number) {
  if (Number.isNaN(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function nowJst() {
  return jstFormatter.format(new Date());
}

function nextRunJst() {
  const now = new Date();
  const jstNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
  const next = new Date(jstNow);
  next.setHours(7, 0, 0, 0);
  if (jstNow >= next) next.setDate(next.getDate() + 1);
  return jstFormatter.format(next);
}
