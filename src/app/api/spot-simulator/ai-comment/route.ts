import { NextResponse } from "next/server";
import { mergePriceSeries } from "@/lib/indicators";
import { getPricesForTicker } from "@/lib/mock-data";
import { analyzePatternSimilarity } from "@/lib/pattern-similarity";
import { fetchStockData } from "@/lib/stock-data";
import {
  accountTypeLabel,
  calculateSpotSimulation,
  type SpotSimulationInput,
  type SpotSimulationSummary
} from "@/lib/spot-simulator";
import type { DailyPrice, NewsItem, Stock } from "@/types";

export const dynamic = "force-dynamic";

type RequestBody = {
  diagnosisMode?: "normal" | "detailed";
  userQuestion?: string;
  stock?: Stock;
  marketMetrics?: {
    close?: number;
    changePercent?: number;
    rsi?: number;
    ma20?: number;
    ma50?: number;
    volumeRatio?: number;
    score?: number;
  };
  input?: SpotSimulationInput;
  simulation?: SpotSimulationSummary;
  news?: Pick<NewsItem, "title" | "publishedAt" | "sentiment" | "impactScore" | "summary">[];
};

type AiRiskComment = {
  summary: string;
  dataFreshness: string;
  riskLevel: "低" | "中" | "高";
  confidence?: "低" | "中" | "高";
  analystView?: string;
  scenarioPrediction?: string;
  userQuestionAnswer?: string;
  entryPriceComment: string;
  positionSizeComment: string;
  exitPlanComment: string;
  taxComment: string;
  fxComment: string;
  technicalComment: string;
  newsComment: string;
  stressTest?: string[];
  blindSpots?: string[];
  checklist: string[];
};

type QuoteSnapshot = {
  price: number;
  previousClose: number | null;
  changePercent: number | null;
  currency: string;
  source: string;
  asOf: string;
};

type FxSnapshot = {
  rate: number;
  source: string;
  asOf: string;
  ok: boolean;
};

type TechnicalSnapshot = {
  rsi: number;
  ma20: number;
  ma50: number;
  volumeRatio: number;
  atrPercent: number;
  recentHigh20: number;
  recentLow20: number;
  recentHigh60: number;
  recentLow60: number;
  latestDailyDate: string;
  source: string;
};

type RuleRisk = {
  score: number;
  level: AiRiskComment["riskLevel"];
  reasons: string[];
};

export async function POST(request: Request) {
  try {
    const body = await request.json() as RequestBody;
    if (!body.stock || !body.input) {
      return NextResponse.json({ ok: false, error: "stock and input are required" }, { status: 400 });
    }

    const enrichment = await buildRealtimeContext(body.stock, body.input, body.news ?? [], body.marketMetrics);
    const enrichedInput = {
      ...body.input,
      fxRate: body.input.currency === "USD" ? enrichment.fx.rate : 1
    };
    const simulation = calculateSpotSimulation(enrichedInput);
    const ruleRisk = buildRuleRisk(enrichedInput, simulation, enrichment.quote, enrichment.technical, enrichment.news, enrichment.fx);
    const diagnosisMode = body.diagnosisMode === "detailed" ? "detailed" : "normal";
    const userQuestion = normalizeUserQuestion(body.userQuestion);
    const payload = { ...body, userQuestion, stock: body.stock, input: enrichedInput, simulation, realtime: enrichment, ruleRisk };
    const fallback = buildRuleBasedComment(payload, diagnosisMode);

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ ok: true, mode: "rule", diagnosisMode, analysis: fallback, realtime: enrichment, ruleRisk, simulation, warning: "OPENAI_API_KEY is not configured." });
    }

    const prompt = diagnosisMode === "detailed" ? buildDetailedSystemPrompt() : buildNormalSystemPrompt();
    const model = getOpenAiModel(diagnosisMode);
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model,
        temperature: diagnosisMode === "detailed" ? 0.35 : 0.2,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: prompt
          },
          {
            role: "user",
            content: JSON.stringify({
              stock: body.stock,
              diagnosisMode,
              realtime: enrichment,
              input: enrichedInput,
              simulation,
              ruleRisk,
              scenarioTable: simulation.scenarios,
              dataQuality: buildDataQuality(enrichment),
              news: enrichment.news.slice(0, 5),
              userQuestion: userQuestion || undefined
            })
          }
        ]
      })
    });

    if (!response.ok) {
      return NextResponse.json({ ok: true, mode: "rule", diagnosisMode, model, analysis: fallback, realtime: enrichment, ruleRisk, simulation, warning: `OpenAI API returned ${response.status}` });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    const parsed = parseAiComment(content, fallback);
    return NextResponse.json({ ok: true, mode: "ai", diagnosisMode, model, analysis: parsed, realtime: enrichment, ruleRisk, simulation });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 500 }
    );
  }
}

function parseAiComment(content: unknown, fallback: AiRiskComment): AiRiskComment {
  if (typeof content !== "string") return fallback;

  try {
    const parsed = JSON.parse(content) as Partial<AiRiskComment>;
    return {
      summary: stringOr(parsed.summary, fallback.summary),
      dataFreshness: stringOr(parsed.dataFreshness, fallback.dataFreshness),
      riskLevel: parsed.riskLevel === "低" || parsed.riskLevel === "中" || parsed.riskLevel === "高" ? parsed.riskLevel : fallback.riskLevel,
      confidence: parsed.confidence === "低" || parsed.confidence === "中" || parsed.confidence === "高" ? parsed.confidence : fallback.confidence,
      analystView: stringOr(parsed.analystView, fallback.analystView ?? ""),
      scenarioPrediction: stringOr(parsed.scenarioPrediction, fallback.scenarioPrediction ?? ""),
      userQuestionAnswer: stringOr(parsed.userQuestionAnswer, fallback.userQuestionAnswer ?? ""),
      entryPriceComment: stringOr(parsed.entryPriceComment, fallback.entryPriceComment),
      positionSizeComment: stringOr(parsed.positionSizeComment, fallback.positionSizeComment),
      exitPlanComment: stringOr(parsed.exitPlanComment, fallback.exitPlanComment),
      taxComment: stringOr(parsed.taxComment, fallback.taxComment),
      fxComment: stringOr(parsed.fxComment, fallback.fxComment),
      technicalComment: stringOr(parsed.technicalComment, fallback.technicalComment),
      newsComment: stringOr(parsed.newsComment, fallback.newsComment),
      stressTest: stringArrayOr(parsed.stressTest, fallback.stressTest),
      blindSpots: stringArrayOr(parsed.blindSpots, fallback.blindSpots),
      checklist: Array.isArray(parsed.checklist) && parsed.checklist.length
        ? parsed.checklist.filter((item): item is string => typeof item === "string").slice(0, 5)
        : fallback.checklist
    };
  } catch {
    return fallback;
  }
}

function buildRuleBasedComment(body: Required<Pick<RequestBody, "stock" | "input" | "simulation">> & RequestBody & { realtime: Awaited<ReturnType<typeof buildRealtimeContext>>; ruleRisk: RuleRisk }, diagnosisMode: "normal" | "detailed"): AiRiskComment {
  const { stock, input, simulation, realtime, ruleRisk } = body;
  const rr = simulation.riskReward ?? 0;
  const latestNews = realtime.news[0];
  const account = accountTypeLabel(input.accountType);
  const entryGap = realtime.quote.price > 0 ? (input.entryPrice - realtime.quote.price) / realtime.quote.price * 100 : 0;
  const userQuestion = normalizeUserQuestion(body.userQuestion);

  const comment: AiRiskComment = {
    summary: `${stock.ticker}の現物エントリー案は、診断時点価格${formatNative(realtime.quote.price, input.currency)}に対して入力エントリー価格が${formatNative(input.entryPrice, input.currency)}です。損切り時の手取り損益は${formatSignedYen(simulation.stopLoss.netPnlJpy)}、利確時の手取り損益は${formatSignedYen(simulation.takeProfit.netPnlJpy)}、リスクリワードは${rr ? rr.toFixed(2) : "-"}で、ルール判定リスクは「${ruleRisk.level}」です。`,
    dataFreshness: `価格: ${realtime.quote.source} ${formatDateTime(realtime.quote.asOf)} / 日足: ${realtime.technical.source} ${realtime.technical.latestDailyDate} / 為替: ${realtime.fx.source} ${formatDateTime(realtime.fx.asOf)}`,
    riskLevel: ruleRisk.level,
    confidence: realtime.quote.source.includes("fallback") || realtime.technical.source === "fallback" ? "低" : realtime.news.length ? "中" : "低",
    analystView: diagnosisMode === "detailed" ? buildFallbackAnalystView(stock, input, realtime, ruleRisk) : undefined,
    scenarioPrediction: diagnosisMode === "detailed" ? buildFallbackScenarioPrediction(stock, input, realtime, ruleRisk) : undefined,
    userQuestionAnswer: userQuestion ? buildFallbackUserQuestionAnswer(userQuestion, stock, input, simulation, realtime, ruleRisk) : undefined,
    entryPriceComment: `入力エントリー価格は診断時点価格から${entryGap >= 0 ? "+" : ""}${entryGap.toFixed(2)}%です。現在付近で入る前提なら、この差が大きいほどシミュレーション結果と実際の約定後リスクがずれます。`,
    positionSizeComment: `投資額は${formatYen(simulation.positionValueJpy)}です。損切り損失が口座全体の許容損失を超える場合は、株数を下げる前提で再計算してください。`,
    exitPlanComment: `利確ラインは${formatNative(simulation.takeProfit.price, input.currency)}、損切りラインは${formatNative(simulation.stopLoss.price, input.currency)}です。エントリー前にどちらを優先するか決めておくと、値動き中の判断ブレを減らせます。`,
    taxComment: input.accountType === "nisa"
      ? "NISA想定のため利益への課税は0円です。ただし損失が出ても損益通算には使えません。"
      : `${account}想定のため、利益が出た場合のみ20.315%で概算課税します。利確シナリオの税金概算は${formatYen(simulation.takeProfit.taxJpy)}です。`,
    fxComment: input.currency === "USD"
      ? `米国株のためUSD損益をUSD/JPY ${realtime.fx.rate.toFixed(2)}で円換算しています。為替が動くと、株価が同じでも円ベースの損益は変わります。`
      : "国内株想定のため為替換算は行っていません。",
    technicalComment: `RSIは${realtime.technical.rsi.toFixed(1)}、MA20は${formatNative(realtime.technical.ma20, input.currency)}、MA50は${formatNative(realtime.technical.ma50, input.currency)}、ATR目安は${realtime.technical.atrPercent.toFixed(2)}%です。${ruleRisk.reasons.join(" / ") || "大きな機械的警戒条件は限定的です。"}`,
    newsComment: latestNews
      ? `直近ニュース「${latestNews.title}」のセンチメントは${latestNews.sentiment}です。ニュースは短期変動要因なので、計算上の損切り幅と合わせて確認してください。`
      : "この銘柄の直近ニュースは渡されていません。ニュース要因なしではなく、未取得として扱ってください。",
    checklist: [
      "損切り時の円換算損失が許容額内か確認",
      "利確と損切りの価格を注文前に固定",
      input.currency === "USD" ? "USD/JPYが変動した場合の円損益を再計算" : "手数料込みの円損益を確認",
      input.accountType === "nisa" ? "NISA枠と損益通算不可の影響を確認" : "課税後の手取りで判断"
    ]
  };

  if (diagnosisMode === "detailed") {
    comment.stressTest = [
      "寄付きやニュース直後に損切り価格を飛び越えて下落すると、想定損失より大きくなる可能性があります。",
      input.currency === "USD" ? "株価シナリオが想定通りでも、USD/JPYが円高に動くと円ベースの手取りは悪化します。" : "国内株でも急変時はスプレッドや約定価格が想定からずれる可能性があります。",
      "出来高が急減した場合、低位株・小型株では想定価格での退出が難しくなることがあります。"
    ];
    comment.blindSpots = [
      realtime.news.length ? "ニュースは取得記事ベースであり、適時開示や決算資料を完全に網羅しているわけではありません。" : "ニュースが未取得のため、材料面の見落としリスクがあります。",
      "税金はアプリ内の概算であり、実際の口座区分・手数料体系・為替レートで差が出ます。",
      "ATRは日足ベースの目安で、当日中の急変や時間外取引を完全には表しません。"
    ];
  }

  return comment;
}

function normalizeUserQuestion(value: unknown) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, 600);
}

async function buildRealtimeContext(
  stock: Stock,
  input: SpotSimulationInput,
  providedNews: Pick<NewsItem, "title" | "publishedAt" | "sentiment" | "impactScore" | "summary">[],
  providedMetrics?: RequestBody["marketMetrics"]
) {
  const [quoteResult, dailyResult, fxResult, newsResult] = await Promise.allSettled([
    fetchYahooQuote(stock.ticker),
    fetchStockData(stock.ticker),
    input.currency === "USD" ? fetchUsdJpyRate() : Promise.resolve({ rate: 1, source: "JPY", asOf: new Date().toISOString(), ok: true } satisfies FxSnapshot),
    fetchRealtimeNews(stock, providedNews)
  ]);

  const dailyData = dailyResult.status === "fulfilled" ? dailyResult.value : null;
  const localPrices = getPricesForTicker(stock.ticker) ?? [];
  const mergedPrices = mergePriceSeries(localPrices, dailyData?.prices ?? []);
  const latestDaily = mergedPrices.at(-1) ?? dailyData?.prices.at(-1);
  const quote = quoteResult.status === "fulfilled"
    ? quoteResult.value
    : buildFallbackQuote(input, latestDaily, providedMetrics);
  const fx = fxResult.status === "fulfilled" ? fxResult.value : { rate: input.fxRate || 150, source: "入力値", asOf: new Date().toISOString(), ok: false };
  const technical = buildTechnicalSnapshot(mergedPrices, latestDaily, providedMetrics);
  const patternSimilarity = analyzePatternSimilarity(mergedPrices);
  const news = newsResult.status === "fulfilled" ? newsResult.value : providedNews;

  return { quote, fx, technical, news, patternSimilarity };
}

async function fetchYahooQuote(ticker: string): Promise<QuoteSnapshot> {
  const symbol = normalizeYahooSymbol(ticker);
  const response = await fetch(`https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1m`, {
    headers: { "user-agent": "Mozilla/5.0" },
    next: { revalidate: 0 }
  });
  if (!response.ok) throw new Error(`Yahoo quote error: ${response.status}`);

  const payload = await response.json() as {
    chart?: {
      result?: Array<{
        meta?: { regularMarketPrice?: number; previousClose?: number; currency?: string; regularMarketTime?: number };
        timestamp?: number[];
        indicators?: { quote?: Array<{ close?: Array<number | null> }> };
      }>;
    };
  };
  const result = payload.chart?.result?.[0];
  const closes = result?.indicators?.quote?.[0]?.close?.filter((value): value is number => Number.isFinite(value)) ?? [];
  const price = result?.meta?.regularMarketPrice ?? closes.at(-1);
  if (!Number.isFinite(price) || !price) throw new Error(`${ticker}: realtime quote not found`);

  const previousClose = result?.meta?.previousClose ?? null;
  const timestamp = result?.meta?.regularMarketTime ?? result?.timestamp?.at(-1);
  return {
    price,
    previousClose,
    changePercent: previousClose && previousClose > 0 ? (price - previousClose) / previousClose * 100 : null,
    currency: result?.meta?.currency ?? "USD",
    source: "Yahoo Finance realtime chart",
    asOf: timestamp ? new Date(timestamp * 1000).toISOString() : new Date().toISOString()
  };
}

async function fetchUsdJpyRate(): Promise<FxSnapshot> {
  const response = await fetch("https://query2.finance.yahoo.com/v8/finance/chart/JPY=X?range=1d&interval=1m", {
    headers: { "user-agent": "Mozilla/5.0" },
    next: { revalidate: 0 }
  });
  if (!response.ok) throw new Error(`USD/JPY error: ${response.status}`);

  const payload = await response.json() as {
    chart?: {
      result?: Array<{
        meta?: { regularMarketPrice?: number; regularMarketTime?: number };
        timestamp?: number[];
        indicators?: { quote?: Array<{ close?: Array<number | null> }> };
      }>;
    };
  };
  const result = payload.chart?.result?.[0];
  const closes = result?.indicators?.quote?.[0]?.close?.filter((value): value is number => Number.isFinite(value)) ?? [];
  const rate = result?.meta?.regularMarketPrice ?? closes.at(-1);
  if (!Number.isFinite(rate) || !rate) throw new Error("USD/JPY rate not found");

  const timestamp = result?.meta?.regularMarketTime ?? result?.timestamp?.at(-1);
  return {
    rate,
    source: "Yahoo Finance",
    asOf: timestamp ? new Date(timestamp * 1000).toISOString() : new Date().toISOString(),
    ok: true
  };
}

async function fetchRealtimeNews(stock: Stock, fallback: Pick<NewsItem, "title" | "publishedAt" | "sentiment" | "impactScore" | "summary">[]) {
  const key = process.env.NEWS_API_KEY;
  if (!key) return fallback.slice(0, 5);

  const from = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const params = new URLSearchParams({
    q: `("${stock.companyName}" OR ${stock.ticker} OR "${stock.ticker} stock") AND (stock OR shares OR earnings OR analyst OR revenue OR partnership OR offering)`,
    language: "en",
    pageSize: "5",
    sortBy: "publishedAt",
    from,
    apiKey: key
  });
  const response = await fetch(`https://newsapi.org/v2/everything?${params.toString()}`, { next: { revalidate: 0 } });
  if (!response.ok) return fallback.slice(0, 5);

  const payload = await response.json() as { articles?: Array<{ title?: string; publishedAt?: string; description?: string; content?: string }> };
  const articles = payload.articles ?? [];
  if (!articles.length) return fallback.slice(0, 5);

  return articles.filter((article) => article.title).slice(0, 5).map((article) => ({
    title: article.title ?? `${stock.ticker} news`,
    publishedAt: article.publishedAt ?? new Date().toISOString(),
    sentiment: "Neutral" as const,
    impactScore: 5,
    summary: article.description ?? article.content ?? "ニュース要約を取得できませんでした。"
  }));
}

function buildFallbackQuote(input: SpotSimulationInput, latestDaily?: DailyPrice, providedMetrics?: RequestBody["marketMetrics"]): QuoteSnapshot {
  const price = providedMetrics?.close ?? latestDaily?.close ?? input.entryPrice;
  const previousClose = latestDaily ? latestDaily.close / (1 + latestDaily.changePercent / 100) : null;
  return {
    price,
    previousClose,
    changePercent: providedMetrics?.changePercent ?? latestDaily?.changePercent ?? null,
    currency: input.currency,
    source: latestDaily?.source ? `${latestDaily.source} daily fallback` : "input fallback",
    asOf: latestDaily?.date ? new Date(`${latestDaily.date}T00:00:00Z`).toISOString() : new Date().toISOString()
  };
}

function buildTechnicalSnapshot(prices: DailyPrice[], latestDaily?: DailyPrice, providedMetrics?: RequestBody["marketMetrics"]): TechnicalSnapshot {
  const latest = latestDaily ?? null;
  return {
    rsi: providedMetrics?.rsi ?? latest?.rsi ?? 50,
    ma20: providedMetrics?.ma20 ?? latest?.ma20 ?? latest?.close ?? 0,
    ma50: providedMetrics?.ma50 ?? latest?.ma50 ?? latest?.close ?? 0,
    volumeRatio: providedMetrics?.volumeRatio ?? latest?.volumeRatio ?? 0,
    atrPercent: calculateAtrPercent(prices),
    recentHigh20: recentHigh(prices, 20, latest?.close ?? 0),
    recentLow20: recentLow(prices, 20, latest?.close ?? 0),
    recentHigh60: recentHigh(prices, 60, latest?.close ?? 0),
    recentLow60: recentLow(prices, 60, latest?.close ?? 0),
    latestDailyDate: latest?.date ?? "unknown",
    source: latest?.source ?? "fallback"
  };
}

function recentHigh(prices: DailyPrice[], count: number, fallback: number) {
  const target = prices.slice(-count);
  if (!target.length) return fallback;
  return Math.max(...target.map((price) => price.high));
}

function recentLow(prices: DailyPrice[], count: number, fallback: number) {
  const target = prices.slice(-count);
  if (!target.length) return fallback;
  return Math.min(...target.map((price) => price.low));
}

function calculateAtrPercent(prices: DailyPrice[]) {
  const target = prices.slice(-15);
  if (target.length < 2) return 0;
  const ranges = target.slice(1).map((price, index) => {
    const previousClose = target[index].close;
    return Math.max(
      price.high - price.low,
      Math.abs(price.high - previousClose),
      Math.abs(price.low - previousClose)
    );
  });
  const atr = ranges.reduce((sum, value) => sum + value, 0) / ranges.length;
  const latestClose = target.at(-1)?.close ?? 0;
  return latestClose > 0 ? atr / latestClose * 100 : 0;
}

function buildRuleRisk(
  input: SpotSimulationInput,
  simulation: SpotSimulationSummary,
  quote: QuoteSnapshot,
  technical: TechnicalSnapshot,
  news: Pick<NewsItem, "title" | "publishedAt" | "sentiment" | "impactScore" | "summary">[],
  fx: FxSnapshot
): RuleRisk {
  const reasons: string[] = [];
  let score = 0;
  const rr = simulation.riskReward ?? 0;
  const stopLossRate = simulation.positionValueJpy > 0 ? Math.abs(simulation.stopLoss.netPnlJpy) / simulation.positionValueJpy : 0;
  const stopLossPercent = Math.abs(input.stopLossPercent);
  const quoteAgeHours = (Date.now() - new Date(quote.asOf).getTime()) / 36e5;

  if (quoteAgeHours > 24) {
    score += 2;
    reasons.push("価格データが24時間超古い");
  } else if (quoteAgeHours > 6) {
    score += 1;
    reasons.push("価格データが6時間超古い");
  }
  if (rr < 1) {
    score += 2;
    reasons.push("R/Rが1.0未満");
  } else if (rr < 1.5) {
    score += 1;
    reasons.push("R/Rが1.5未満");
  }
  if (stopLossRate >= 0.12) {
    score += 2;
    reasons.push("損切り時損失が投資額の12%以上");
  } else if (stopLossRate >= 0.06) {
    score += 1;
    reasons.push("損切り時損失が投資額の6%以上");
  }
  if (technical.atrPercent > stopLossPercent) {
    score += 2;
    reasons.push("ATR目安が損切り幅を上回る");
  } else if (technical.atrPercent > stopLossPercent * 0.75) {
    score += 1;
    reasons.push("ATR目安が損切り幅に近い");
  }
  if (technical.rsi >= 70 || technical.rsi <= 30) {
    score += 1;
    reasons.push("RSIが過熱または売られ過ぎ圏");
  }
  if (quote.price < technical.ma20 && quote.price < technical.ma50) {
    score += 1;
    reasons.push("価格がMA20/MA50を下回る");
  }
  if (news.some((item) => item.sentiment === "Negative" && item.impactScore >= 7)) {
    score += 1;
    reasons.push("影響度の高いネガティブニュースあり");
  }
  if (input.currency === "USD" && !fx.ok) {
    score += 1;
    reasons.push("USD/JPYがリアルタイム取得できず入力値で代用");
  }

  return {
    score,
    level: score >= 5 ? "高" : score >= 3 ? "中" : "低",
    reasons
  };
}

function stringOr(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function stringArrayOr(value: unknown, fallback: string[] | undefined) {
  if (!Array.isArray(value)) return fallback;
  const items = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, 6);
  return items.length ? items : fallback;
}

function buildFallbackAnalystView(
  stock: Stock,
  input: SpotSimulationInput,
  realtime: Awaited<ReturnType<typeof buildRealtimeContext>>,
  ruleRisk: RuleRisk
) {
  const shortLow = realtime.technical.recentLow20 || realtime.technical.ma20 || realtime.quote.price;
  const shortHigh = realtime.technical.recentHigh20 || realtime.quote.price;
  const mediumHigh = Math.max(realtime.technical.recentHigh60 || shortHigh, shortHigh);
  const danger = Math.min(shortLow, realtime.technical.ma20 || shortLow);
  const newsTone = realtime.news.length
    ? `直近ニュースは${realtime.news.map((item) => item.sentiment).join(" / ")}で、材料確認はニュース本文と鮮度を優先して見るべきです。`
    : "直近ニュースが十分に取得できていないため、材料面の評価はまだ弱いです。";
  const pattern10 = realtime.patternSimilarity.horizons.find((item) => item.days === 10);
  const pattern20 = realtime.patternSimilarity.horizons.find((item) => item.days === 20);
  const patternTone = pattern10 && pattern10.sampleCount
    ? `過去類似パターンでは10営業日平均が${formatSignedPercent(pattern10.averageReturn)}、上昇確率が${pattern10.winRate.toFixed(0)}%です${pattern20 && pattern20.sampleCount ? `。20営業日の最小/最大は${formatSignedPercent(pattern20.minReturn)}〜${formatSignedPercent(pattern20.maxReturn)}で、値幅リスクも残ります` : ""}。`
    : "過去類似パターンはサンプル不足のため、今回のシナリオ判断には強く使えません。";
  const competenceTone = realtime.news.length
    ? `${stock.companyName}の事業理解は、取得済みニュースとセクター情報だけでは限定的なので、収益構造と利益の持続性を別途確認するまで信頼度は上げすぎない方がいいです。`
    : `${stock.companyName}の事業・収益構造を判断するニュースが不足しているため、現時点ではサークル・オブ・コンピテンス外として慎重に扱うべきです。`;

  return [
    `私が今の${stock.ticker}を評価すると、まずRule 1の元本保全では${formatNative(danger, input.currency)}を出来高を伴って明確に割る展開を最重要リスクとして見ます。`,
    `50%下落は回復に100%上昇が必要なので、短期の上値期待よりも、この危険ラインを割った時に損失を深くしない設計が優先です。`,
    `Rule 2の理解できる事業かという点では、${competenceTone}`,
    `Rule 3の忍耐では、短期は${formatNative(shortLow, input.currency)}〜${formatNative(shortHigh, input.currency)}のレンジを待ち、出来高を伴って${formatNative(shortHigh, input.currency)}を再突破できるかを確認したい局面です。`,
    `そこを超えて維持できれば、次は60日高値圏の${formatNative(mediumHigh, input.currency)}再挑戦を意識できますが、急いで飛びつく根拠にはしません。`,
    `${patternTone}`,
    `${newsTone}`,
    `現時点の機械判定リスクは${ruleRisk.level}で、主な注意点は${ruleRisk.reasons.join("、") || "データ鮮度と執行価格のずれ"}です。`
  ].join("\n");
}

function buildFallbackScenarioPrediction(
  stock: Stock,
  input: SpotSimulationInput,
  realtime: Awaited<ReturnType<typeof buildRealtimeContext>>,
  ruleRisk: RuleRisk
) {
  const support = Math.min(realtime.technical.recentLow20 || realtime.quote.price, realtime.technical.ma20 || realtime.quote.price);
  const resistance = realtime.technical.recentHigh20 || realtime.quote.price;
  const nextResistance = Math.max(realtime.technical.recentHigh60 || resistance, resistance);
  const pattern10 = realtime.patternSimilarity.horizons.find((item) => item.days === 10);
  const pattern20 = realtime.patternSimilarity.horizons.find((item) => item.days === 20);
  const trendIsConstructive = realtime.quote.price >= realtime.technical.ma20 && realtime.technical.ma20 >= realtime.technical.ma50;
  const volumeIsActive = realtime.technical.volumeRatio >= 1.2;
  const shortBias = trendIsConstructive && volumeIsActive
    ? "上値再テスト寄り"
    : realtime.quote.price < realtime.technical.ma20
      ? "下値確認優先"
      : "中立から方向待ち";
  const patternText = pattern10?.sampleCount
    ? `過去類似では10営業日平均${formatSignedPercent(pattern10.averageReturn)}、上昇確率${pattern10.winRate.toFixed(0)}%です${pattern20?.sampleCount ? `。20営業日の範囲は${formatSignedPercent(pattern20.minReturn)}〜${formatSignedPercent(pattern20.maxReturn)}です` : ""}。`
    : "過去類似パターンはサンプル不足で、予測材料としては弱いです。";
  const confidence = ruleRisk.level === "高" || !pattern10?.sampleCount ? "低め" : realtime.news.length ? "中程度" : "限定的";

  return [
    `${stock.ticker}のリアルタイム取得データで見ると、今後1〜2週間の基本シナリオは「${shortBias}」です。`,
    `上方向は${formatNative(resistance, input.currency)}を出来高を伴って上抜け、維持できるかが確認点です。`,
    `その条件がそろう場合、次の意識ラインは直近60日高値圏の${formatNative(nextResistance, input.currency)}です。`,
    `下方向の危険シナリオは${formatNative(support, input.currency)}を明確に割り、終値で戻せない動きです。`,
    `${patternText}`,
    `この予測の信頼度は${confidence}です。これは売買指示ではなく、現在データから作る条件付きシナリオです。`
  ].join("\n");
}

function buildFallbackUserQuestionAnswer(
  question: string,
  stock: Stock,
  input: SpotSimulationInput,
  simulation: SpotSimulationSummary,
  realtime: Awaited<ReturnType<typeof buildRealtimeContext>>,
  ruleRisk: RuleRisk
) {
  const support = Math.min(realtime.technical.recentLow20 || realtime.quote.price, realtime.technical.ma20 || realtime.quote.price);
  const resistance = realtime.technical.recentHigh20 || realtime.quote.price;
  const nextResistance = Math.max(realtime.technical.recentHigh60 || resistance, resistance);
  const rr = simulation.riskReward ?? 0;
  const pattern10 = realtime.patternSimilarity.horizons.find((item) => item.days === 10);
  const patternText = pattern10?.sampleCount
    ? `過去類似パターンは10営業日平均${formatSignedPercent(pattern10.averageReturn)}、上昇確率${pattern10.winRate.toFixed(0)}%で、予測材料としては「補助情報」です。`
    : "過去類似パターンはサンプル不足で、今後の動きの根拠としては弱いです。";
  const newsText = realtime.news.length
    ? `直近ニュースは${realtime.news.length}件ありますが、ニュース本文・鮮度・決算/開示との整合確認が必要です。`
    : "直近ニュースが十分に取得できていないため、材料面の信頼度は低めに置くべきです。";

  return [
    `質問「${question}」へのルールベース回答です。`,
    `Rule 1の元本保全では、${formatNative(support, input.currency)}を明確に割ると、今後の動きは警戒シナリオ優先になります。50%下落は100%上昇しないと戻らないため、上値期待より損失を深くしない設計が先です。`,
    `Rule 2では、${stock.companyName}の事業・収益構造・利益持続性をこのデータだけで十分に理解できない場合、テクニカルが良く見えても信頼度は上げすぎません。`,
    `Rule 3では、今後1〜2週間は${formatNative(support, input.currency)}〜${formatNative(resistance, input.currency)}のレンジをどう抜けるかを待つ局面です。`,
    `上方向は出来高を伴って${formatNative(resistance, input.currency)}を超えて維持できるなら、${formatNative(nextResistance, input.currency)}再挑戦が条件付きシナリオになります。`,
    `下方向は損切りライン${formatNative(simulation.stopLoss.price, input.currency)}と支持線${formatNative(support, input.currency)}の距離が近いほど、通常の値幅で計画が崩れやすくなります。現在のR/Rは${rr ? rr.toFixed(2) : "-"}で、機械判定リスクは${ruleRisk.level}です。`,
    `${patternText}`,
    `${newsText}`
  ].join("\n");
}

function buildNormalSystemPrompt() {
  return [
    "You are a Japanese risk analyst for a stock cash-position simulator.",
    buildBuffettDiagnosticRules(),
    "Use only the JSON data provided by the application.",
    "Do not assume or invent real-time prices, news, exchange rates, or market conditions.",
    "If quote, FX, or news timestamps are stale, clearly mention the freshness limitation.",
    "Do not recommend buy, sell, hold, or specific investment action.",
    "Do not change deterministic simulation numbers or tax calculations.",
    "Explain only risk, entry price context, position sizing, exit plan, tax impact, FX impact, technical context, and news context.",
    "In summary, briefly reflect the Buffett diagnostic frame: capital preservation, whether the business is understandable from supplied data, and patience/time horizon.",
    "If userQuestion is supplied, answer it in userQuestionAnswer using the same Buffett diagnostic frame, current quote/technicals/news/patternSimilarity/scenarioTable, and conditional future-movement scenarios. Do not ignore the user's question.",
    "Return strict JSON with keys: summary, dataFreshness, riskLevel, userQuestionAnswer, entryPriceComment, positionSizeComment, exitPlanComment, taxComment, fxComment, technicalComment, newsComment, checklist.",
    "riskLevel must be one of: 低, 中, 高. checklist must be 3 to 5 short Japanese strings."
  ].join(" ");
}

function buildBuffettDiagnosticRules() {
  return [
    "Use Warren Buffett's legendary investment discipline as a diagnostic framework, not as a claim that Buffett would buy or sell the stock.",
    "Rule 1: Never lose money, and never forget Rule 1. Prioritize capital preservation over chasing quick returns. Explain that a 50% loss requires a 100% gain just to break even, so defensive risk control is paramount.",
    "Rule 2: Stay within the circle of competence. Only treat the setup as investable if the supplied data lets the user understand the business or industry, how the company makes money, and whether profits can be sustained. If the supplied data is insufficient, say confidence must be lower.",
    "Rule 3: Practice extreme patience. Wealth compounds over time, and the market often transfers wealth from impatient participants to patient ones. Evaluate whether the plan is patient and evidence-based or just reacting to short-term price movement.",
    "When applying these rules, do not moralize and do not give a buy/sell/hold instruction. Convert the three rules into concrete risk checks: downside protection, business understanding, and patience/time-horizon discipline.",
    "If technical momentum looks attractive but Buffett rules are weak, say so clearly. If the business is not understandable from supplied news/data, do not let RSI, MA, or short-term news alone create high confidence."
  ].join(" ");
}

function getOpenAiModel(mode: "normal" | "detailed") {
  if (mode === "detailed") return process.env.OPENAI_DETAILED_MODEL || "gpt-4o";
  return process.env.OPENAI_NORMAL_MODEL || "gpt-4o-mini";
}

function buildDetailedSystemPrompt() {
  return [
    "You are a senior Japanese risk analyst and trading-risk coach for a cash stock entry simulator.",
    "Write for an experienced individual investor who understands risk-reward, volatility, stop placement, liquidity, and tax impact.",
    buildBuffettDiagnosticRules(),
    "Use only the JSON data provided by the application.",
    "Do not browse the web.",
    "Do not assume or invent real-time prices, news, exchange rates, filings, market conditions, or company facts.",
    "Do not recommend buy, sell, hold, entry, exit, or position changes as investment advice. You may give risk-management advice such as what to verify, what would invalidate the plan, and what conditions would make the plan fragile.",
    "Do not change deterministic simulation numbers, tax calculations, FX conversion, ruleRisk, or scenario table values.",
    "Your job is to stress-test the user's entry plan, identify weak assumptions, and give advanced, data-grounded risk-management advice in Japanese.",
    "Be specific and numerical whenever the supplied data supports it. Reference exact levels, percentages, risk-reward, ATR%, stop-loss loss, take-profit net profit, FX rate, RSI, MA20, MA50, volume ratio, data age, and ruleRisk reasons.",
    "Use a professional but direct tone. Avoid generic advice. Every major point must connect to supplied data.",
    "Do not merely explain or paraphrase the screen data. Synthesize the technical data, news data, scenario table, and ruleRisk into an expert view of what matters most.",
    "Apply the Buffett rules explicitly in the analysis: first check downside/capital preservation, then whether the business/industry is understandable from supplied data, then whether the plan requires patience or is merely chasing short-term movement.",
    "Produce an analystView field that reads like a concise senior analyst note in Japanese. It must start with '私が今の [ticker] を評価すると...' and then apply Buffett's three rules in order before discussing technical upside.",
    "analystView structure must be: sentence 1 = Rule 1 capital preservation and the most important downside/danger level; sentence 2 = why avoiding large losses matters, including the idea that a 50% loss needs a 100% gain to recover; sentence 3 = Rule 2 circle of competence, whether supplied data is enough to understand business/industry/profit durability; sentence 4 = Rule 3 patience, whether the user should wait for better evidence or whether the plan is impatient; sentence 5-8 = short-term range, medium-term condition, upside trigger, news interpretation, and past pattern evidence.",
    "Produce a scenarioPrediction field. It must be a conditional real-time scenario forecast based only on supplied quote, daily history, technicals, news, FX, ruleRisk, scenarioTable, and patternSimilarity.",
    "scenarioPrediction must include: 1-2 week base scenario, 1-3 month conditional scenario, upside trigger, downside invalidation/danger level, past similar-pattern evidence, and confidence limitation.",
    "Do not call scenarioPrediction a certainty. Use phrases like '可能性', '条件付き', '優先シナリオ', and '警戒シナリオ'.",
    "In analystView, you may discuss conditional possibilities such as 'if momentum/news/sector flow continues, a re-test of resistance is possible' and 'if support breaks with volume, deeper correction becomes a risk'. Do not express certainty.",
    "Use recentHigh20, recentLow20, recentHigh60, recentLow60, MA20, MA50, ATR%, and quote to infer short-term range, resistance, support, and danger levels. Do not invent price levels that are not derived from supplied data.",
    "Use patternSimilarity to compare the current setup with similar historical daily-price patterns. Discuss 5/10/20 trading-day outcomes using sampleCount, averageReturn, medianReturn, winRate, maxReturn, and minReturn. Treat it as probabilistic scenario evidence, not a forecast or guarantee.",
    "If patternSimilarity.sampleCount is low, explicitly lower confidence. If similar patterns show wide max/min dispersion, explain that the scenario is fragile even when averageReturn is positive.",
    "In analystView, include one short sentence about past similar patterns, for example whether 10-trading-day and 20-trading-day outcomes lean upward, downward, neutral, or too volatile to rely on.",
    "Use provided news only. If the provided news does not mention a catalyst, say that current provided news is insufficient to confirm that catalyst. Never invent catalysts such as IPO, government support, earnings, or sector inflow unless present in the news JSON.",
    "If userQuestion is supplied, produce a userQuestionAnswer field that directly answers the user's question. It must not be a generic summary. It must use the Buffett rules, current quote, support/resistance derived from supplied data, scenario table, tax/FX where relevant, news freshness, and patternSimilarity. It must explain likely future movement as conditional scenarios for 1-2 weeks and 1-3 months when the question asks about future movement.",
    "For userQuestionAnswer, start by restating the user's question in short form, then give a senior analyst answer in Japanese. Include: Rule 1 downside/invalidation, Rule 2 business-understanding confidence, Rule 3 patience/waiting condition, upside condition, downside condition, and what data would improve confidence. Do not say buy/sell/hold.",
    "Each review field must start with a clear expert conclusion, then explain the data basis. Good: '損切り幅がATRに対して浅く、通常の値幅で刈られやすい'. Bad: 'RSIは62、MA20は...'.",
    "When technicals and news point in different directions, explicitly describe the conflict and which risk should dominate the user's attention.",
    "Rank the top 2 to 3 risk drivers by importance in the summary. The summary should answer: 'What is the main risk in this entry plan, and what should an experienced trader check first?'",
    "The summary must also include a Buffett-style judgment: whether the setup protects capital, whether the user appears to understand the business from the provided data, and whether patience is required before improving confidence.",
    "Give conditional advice using if/then language, such as what would make the plan fragile, what data would improve confidence, and what market behavior would invalidate the scenario. Do not phrase it as a buy/sell/hold recommendation.",
    "Analyze entry price quality versus quote: premium/discount to current quote, whether the entry assumption is stale, and how the plan changes if execution price slips.",
    "Analyze position sizing: position value, stop-loss net loss, loss percentage versus position value, concentration risk, and whether the scenario is sensitive to small price moves. Do not prescribe a specific share count.",
    "Analyze exit-plan quality: take-profit, stop-loss, risk-reward, whether the stop is realistic versus ATR/volatility, and whether the plan depends too much on perfect execution.",
    "Analyze technical context: RSI, MA20, MA50, volume ratio, ATR%, trend alignment, overheat risk, breakdown risk, and volatility regime. Convert indicators into an interpretation of market structure, not a list of indicator values.",
    "Analyze execution risks: opening gaps, after-hours moves, spread widening, low liquidity, small-cap volatility, and the possibility that stop-loss execution differs from the modeled stop price.",
    "Analyze FX risk for USD stocks: explain how USD/JPY affects JPY profit/loss and whether FX is a secondary or material driver based on the position value.",
    "Analyze tax/account type: explain taxable account versus NISA impact, net-of-tax outcome, and NISA loss-offset limitation when relevant. Do not provide legal or tax advice.",
    "Analyze news and data quality: news count, timestamp/freshness, missing news, fallback data, quote age, daily data age, and whether confidence should be reduced. Explain whether news supports the technical setup, contradicts it, or is too weak/stale to matter.",
    "Analyze circle of competence: using only supplied company name, sector, news, and data, state whether there is enough information to understand how the company makes money and sustains profits. If not enough, lower confidence and say the stock should remain outside the user's circle of competence until the business model and profit durability are verified.",
    "Analyze patience: explain whether the current setup rewards waiting for better evidence, whether the entry plan depends on quick price movement, and whether compounding/patient holding logic is supported or unsupported by the provided data.",
    "Provide decision-support advice only: define what should be checked before acting, what would invalidate the scenario, and what risk the user is accepting. Do not say the user should enter, buy, sell, hold, or avoid.",
    "For checklist items, do not write generic items like 'check risk'. Write concrete pre-trade checks such as quote freshness, spread/liquidity, stop distance versus ATR, news timestamp, FX rate, and after-tax outcome.",
    "If data is stale, missing, fallback, or incomplete, explicitly lower confidence and explain why.",
    "Return strict JSON in Japanese with keys: summary, dataFreshness, riskLevel, confidence, analystView, scenarioPrediction, userQuestionAnswer, entryPriceComment, positionSizeComment, exitPlanComment, taxComment, fxComment, technicalComment, newsComment, stressTest, blindSpots, checklist.",
    "riskLevel and confidence must be one of: 低, 中, 高.",
    "summary must be concise but include the dominant risk and top risk drivers, not a restatement of numbers.",
    "analystView must be 6 to 9 short Japanese sentences and must explicitly mention: Rule 1/元本保全, Rule 2/サークル・オブ・コンピテンス or 理解できる事業, Rule 3/忍耐, short-term range view, medium-term condition, upside condition, danger level, news interpretation, and past similar-pattern evidence.",
    "analystView must not be only technical analysis. If it does not evaluate capital preservation, business understandability, and patience, it is invalid.",
    "scenarioPrediction must be 5 to 8 short Japanese sentences and must not repeat analystView verbatim.",
    "If userQuestion is present, userQuestionAnswer must be 6 to 10 short Japanese sentences and must answer that exact question using supplied data. If userQuestion is absent, userQuestionAnswer can be an empty string.",
    "entryPriceComment, positionSizeComment, exitPlanComment, technicalComment, and newsComment must each contain practical expert advice based on the data and must avoid pure data narration.",
    "stressTest must be 3 to 5 short strings covering adverse but realistic cases.",
    "blindSpots must be 3 to 5 short strings covering missing data or hidden assumptions.",
    "checklist must be 4 to 6 action-oriented strings. Checklist items must be concrete checks before placing an order, not buy/sell recommendations."
  ].join(" ");
}

function buildDataQuality(realtime: Awaited<ReturnType<typeof buildRealtimeContext>>) {
  const quoteAgeMinutes = Math.max(Math.round((Date.now() - new Date(realtime.quote.asOf).getTime()) / 60000), 0);
  const fxAgeMinutes = Math.max(Math.round((Date.now() - new Date(realtime.fx.asOf).getTime()) / 60000), 0);
  return {
    quoteAgeMinutes,
    fxAgeMinutes,
    newsCount: realtime.news.length,
    similarPatternCount: realtime.patternSimilarity.sampleCount,
    priceSource: realtime.quote.source,
    fxSource: realtime.fx.source,
    dailySource: realtime.technical.source,
    latestDailyDate: realtime.technical.latestDailyDate,
    hasRealtimeQuoteFallback: realtime.quote.source.includes("fallback"),
    hasFxFallback: !realtime.fx.ok
  };
}

function formatSignedPercent(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatYen(value: number) {
  return new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 }).format(value || 0);
}

function formatSignedYen(value: number) {
  const formatted = formatYen(Math.abs(value));
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `-${formatted}`;
  return formatted;
}

function formatNative(value: number, currency: "USD" | "JPY") {
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "JPY" ? 0 : 2
  }).format(value || 0);
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function normalizeYahooSymbol(ticker: string) {
  if (/^\d{4}$/.test(ticker)) return `${ticker}.T`;
  if (/^\d{4}\.JP$/i.test(ticker)) return ticker.replace(/\.JP$/i, ".T");
  return ticker;
}
