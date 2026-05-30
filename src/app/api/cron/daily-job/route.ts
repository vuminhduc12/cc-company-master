import { NextRequest, NextResponse } from "next/server";
import { getPricesForTicker, news as mockNews, prices, report as mockReport, watchlist } from "@/lib/mock-data";
import { analyzeStock, scoreStock, statusFromScore } from "@/lib/scoring";
import { saveJobResult } from "@/lib/supabase";
import type { AiJobResult, AiTask, DailyPrice, NewsItem, Sentiment, Stock, StockAnalysisResult } from "@/types";

const jstFormatter = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit"
});

export async function GET(request: NextRequest) {
  return runDailyJob(request, "cron");
}

export async function POST(request: NextRequest) {
  return runDailyJob(request, "manual");
}

async function runDailyJob(request: NextRequest, source: "cron" | "manual") {
  const authError = authorize(request, source);
  if (authError) return authError;

  const hasAllKeys = Boolean(process.env.OPENAI_API_KEY && process.env.STOCK_API_KEY && process.env.NEWS_API_KEY);
  if (source === "cron" && !hasAllKeys) {
    return NextResponse.json(
      buildErrorResult("API keys are not configured. Cron job skipped.", "APIキー未設定のため自動実行をスキップしました。"),
      { status: 412 }
    );
  }

  try {
    const lastRun = nowJst();
    const nextRun = nextRunJst();
    const targets = watchlist.filter((item) => Boolean(getPricesForTicker(item.stock.ticker)));
    const stockResults: StockAnalysisResult[] = [];
    for (const [index, item] of targets.entries()) {
      if (index > 0 && process.env.STOCK_API_KEY) {
        await sleep(1300);
      }
      stockResults.push(await buildStockAnalysis(item.stock, hasAllKeys));
    }
    const successfulResults = stockResults.filter((item) => !item.error);
    if (successfulResults.length === 0) {
      throw new Error(stockResults.map((item) => `${item.stock.ticker}: ${item.error ?? "No data"}`).join(" / "));
    }

    const primary = successfulResults.find((item) => item.stock.ticker === "RGTI") ?? successfulResults[0];
    const allNews = successfulResults.flatMap((item) => item.news);
    const aiMarketScore = Math.round(successfulResults.reduce((sum, item) => sum + item.aiMarketScore, 0) / successfulResults.length);
    const latest = primary.price;
    const tasks = buildTasks(lastRun, nextRun, successfulResults, stockResults);
    const result: AiJobResult = {
      ok: true,
      mode: hasAllKeys ? "live" : "mock",
      status: stockResults.some((item) => item.error) ? "Error" : "Completed",
      lastRun,
      nextRun,
      dataFreshness: latest.date,
      aiMarketScore,
      price: latest,
      news: allNews,
      stocks: stockResults,
      tasks,
      report: buildPortfolioReport(successfulResults, aiMarketScore, nextRun),
      warning: buildWarning(hasAllKeys, stockResults)
    };
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

async function buildStockAnalysis(stock: Stock, hasAllKeys: boolean): Promise<StockAnalysisResult> {
  try {
    const stockData = await fetchStockData(stock.ticker);
    const priceData = stockData.prices;
    const latest = priceData[priceData.length - 1];
    if (!latest) throw new Error("No price data available.");
    const rawNews = await fetchNews(stock);
    const analyzedNews = await analyzeNews(rawNews, latest, stock);
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
    const fallbackNews = hasAllKeys ? [] : mockNews.filter((item) => item.ticker === stock.ticker || stock.ticker === "RGTI");
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

async function fetchStockData(ticker: string): Promise<{ prices: DailyPrice[]; warning?: string }> {
  const key = process.env.STOCK_API_KEY;
  const fallback = getPricesForTicker(ticker);
  if (!key) {
    if (fallback) return { prices: fallback };
    throw new Error(`${ticker} mock price data is not available.`);
  }

  const url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${ticker}&apikey=${key}&outputsize=full`;
  const response = await fetch(url, { next: { revalidate: 0 } });
  if (!response.ok) throw new Error(`Stock API error: ${response.status}`);

  const payload = await response.json() as {
    ["Time Series (Daily)"]?: Record<string, Record<string, string>>;
    Note?: string;
    Information?: string;
    Error?: string;
    ["Error Message"]?: string;
  };
  const series = payload["Time Series (Daily)"];
  if (!series) {
    const message = payload.Note ?? payload.Information ?? payload.Error ?? payload["Error Message"] ?? "Stock API response did not include daily prices.";
    if (fallback && isAlphaVantageLimitMessage(message)) {
      return {
        prices: fallback,
        warning: `${ticker}: Alpha Vantage無料枠の制限に達したため、ローカル履歴データを表示しています。時間を空けて再実行してください。`
      };
    }
    if (fallback) {
      return {
        prices: fallback,
        warning: `${ticker}: 株価APIから最新データを取得できなかったため、ローカル履歴データを表示しています。理由: ${message}`
      };
    }
    throw new Error(message);
  }

  const rows = Object.entries(series)
    .reverse()
    .map(([date, row]) => ({
      date,
      open: Number(row["1. open"]),
      high: Number(row["2. high"]),
      low: Number(row["3. low"]),
      close: Number(row["4. close"]),
      volume: Number(row["5. volume"])
    }));

  return { prices: rows.map((row, index) => {
    const closes = rows.slice(0, index + 1).map((item) => item.close);
    const volumes = rows.slice(Math.max(0, index - 19), index + 1).map((item) => item.volume);
    const previous = rows[index - 1]?.close ?? row.close;
    const macd = average(closes.slice(-12)) - average(closes.slice(-26));
    const previousMacd = index > 0 ? average(rows.slice(0, index).map((item) => item.close).slice(-12)) - average(rows.slice(0, index).map((item) => item.close).slice(-26)) : macd;
    const ma5 = average(closes.slice(-5));
    const ma20 = average(closes.slice(-20));
    const ma50 = average(closes.slice(-50));
    const volumeAverage20 = average(volumes);
    const volumeRatio = volumeAverage20 > 0 ? row.volume / volumeAverage20 : 0;
    const rsi = calculateRsi(closes);
    const high20Breakout = row.close >= Math.max(...closes.slice(-20)) ? "20日高値更新" : "";
    const macdDirection = macd >= previousMacd ? "上昇" : "低下";
    const score = [
      row.close > ma20,
      ma20 > ma50,
      volumeRatio >= 1.2,
      rsi >= 40 && rsi <= 70,
      macdDirection === "上昇",
      Boolean(high20Breakout)
    ].filter(Boolean).length;
    return {
      ...row,
      changePercent: previous > 0 ? ((row.close - previous) / previous) * 100 : 0,
      volumeAverage20,
      volumeRatio,
      intradayRangePercent: row.close > 0 ? ((row.high - row.low) / row.close) * 100 : 0,
      rsi,
      macd,
      macdSignal: previousMacd,
      macdHistogram: macd - previousMacd,
      macdDirection,
      rsiSignal: rsi >= 70 ? "過熱" : rsi >= 55 ? "強気圏" : rsi <= 35 ? "弱気圏" : "中立",
      high20Breakout,
      ma5,
      ma20,
      ma50,
      volumeAverage: volumeAverage20,
      closeAfter5Days: null,
      changeAfter5Days: null,
      closeAfter10Days: null,
      changeAfter10Days: null,
      score,
      pattern: score >= 5 ? "上昇候補" : score <= 2 ? "リスク監視" : "",
      comment: "",
      source: "Alpha Vantage"
    };
  }) };
}

async function fetchNews(stock: Stock): Promise<NewsItem[]> {
  const key = process.env.NEWS_API_KEY;
  const ticker = stock.ticker;
  if (!key) return mockNews.filter((item) => item.ticker === ticker || ticker === "RGTI");

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
  const response = await fetch(url, { next: { revalidate: 0 } });
  if (!response.ok) throw new Error(`News API error: ${response.status}`);

  const payload = await response.json() as { articles?: Array<{ title?: string; url?: string; source?: { name?: string }; publishedAt?: string; description?: string; content?: string }> };
  const seen = new Set<string>();
  return (payload.articles ?? []).filter((article) => {
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
    sentiment: "Neutral",
    impactScore: 5,
    risk: "AI分析待ち",
    opportunity: "AI分析待ち",
    aiComment: "OpenAIで日本語分析します。"
  }));
}

async function analyzeNews(items: NewsItem[], price: DailyPrice, stock: Stock): Promise<NewsItem[]> {
  return Promise.all(items.map(async (item) => {
    const analysis = await analyzeOneNews(item, price, stock);
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

async function analyzeOneNews(item: NewsItem, price: DailyPrice, stock: Stock) {
  const fallback = ruleBasedAnalysis(item, price);
  const key = process.env.OPENAI_API_KEY;
  if (!key) return fallback;

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

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" }
    })
  });

  if (!response.ok) throw new Error(`OpenAI API error: ${response.status}`);
  const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  return parseAnalysis(payload.choices?.[0]?.message?.content, fallback);
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

function buildWarning(hasAllKeys: boolean, results: StockAnalysisResult[]) {
  const warnings = [];
  if (!hasAllKeys) warnings.push("APIキー未設定のためmock-dataで実行しました。");
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

function calculateRsi(closes: number[]) {
  const target = closes.slice(-15);
  if (target.length < 2) return 50;
  let gains = 0;
  let losses = 0;
  for (let index = 1; index < target.length; index += 1) {
    const diff = target[index] - target[index - 1];
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }
  if (losses === 0) return 70;
  const rs = gains / losses;
  return 100 - (100 / (1 + rs));
}

function average(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value: number, min: number, max: number) {
  if (Number.isNaN(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function isAlphaVantageLimitMessage(message: string) {
  const text = message.toLowerCase();
  return text.includes("alpha vantage") || text.includes("free api requests") || text.includes("rate limit") || text.includes("premium");
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
