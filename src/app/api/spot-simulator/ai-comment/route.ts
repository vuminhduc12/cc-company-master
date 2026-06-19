import { NextResponse } from "next/server";
import { callOpenAiChatWithUsageGuard, recordAiCacheHit, resolveAiUserIdFromRequest } from "@/lib/ai-usage";
import { buildSpotSimulatorPrompt, getOpenAiModel, type AiDiagnosisMode } from "@/lib/ai-prompts";
import { mergePriceSeries, validateDailyPriceSeries } from "@/lib/indicators";
import { getPricesForTicker } from "@/lib/mock-data";
import { buildOpenAiCacheKey, getOpenAiCache, setOpenAiCache } from "@/lib/openai-cache";
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
  marketView?: {
    scenario: "upside" | "range" | "downside";
    confidence: "低" | "中" | "高";
    topEvidence: string[];
  };
  historicalPatternView?: string;
  newsImpactView?: string;
  scenarioForecast?: {
    oneToTwoWeeks: string;
    oneToThreeMonths: string;
    upsideTrigger: string;
    downsideInvalidation: string;
    dangerLevel: string;
  };
  riskFilter?: string;
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

type CachedAiComment = {
  analysis: AiRiskComment;
  model: string;
};

type OpenAiSpotPayload = {
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

const spotAiCacheTtlMs = 10 * 60 * 1000;

export async function POST(request: Request) {
  try {
    const body = await request.json() as RequestBody;
    const aiUserId = await resolveAiUserIdFromRequest(request);
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

    const prompt = buildSpotSimulatorPrompt(diagnosisMode);
    const model = getOpenAiModel(diagnosisMode);
    const userPayload = {
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
    };
    const cacheKey = buildOpenAiCacheKey("spot-simulator-ai-comment-v1", {
      model,
      diagnosisMode,
      ticker: body.stock.ticker,
      question: userQuestion,
      input: {
        currency: enrichedInput.currency,
        shares: enrichedInput.shares,
        entryPrice: roundForCache(enrichedInput.entryPrice),
        takeProfitPercent: enrichedInput.takeProfitPercent,
        stopLossPercent: enrichedInput.stopLossPercent,
        accountType: enrichedInput.accountType,
        feeJpy: enrichedInput.feeJpy,
        fxRate: roundForCache(enrichedInput.fxRate)
      },
      quote: {
        price: roundForCache(enrichment.quote.price),
        date: enrichment.technical.latestDailyDate
      },
      news: enrichment.news.slice(0, 5).map((item) => ({
        title: item.title,
        publishedAt: item.publishedAt,
        sentiment: item.sentiment,
        impactScore: item.impactScore
      }))
    });
    const cached = getOpenAiCache<CachedAiComment>(cacheKey);
    if (cached) {
      recordAiCacheHit({
        feature: userQuestion ? "spot_question" : "spot_diagnosis",
        userId: aiUserId,
        ticker: body.stock.ticker,
        model: cached.model,
        promptVersion: diagnosisMode
      });
      return NextResponse.json({ ok: true, mode: "ai", diagnosisMode, model: cached.model, analysis: cached.analysis, realtime: enrichment, ruleRisk, simulation, cached: true, warning: "短時間の同一AI診断をキャッシュから再利用しました。" });
    }

    const temperature = temperatureForModel(model, diagnosisMode);
    const requestBody = {
        model,
        ...(temperature === undefined ? {} : { temperature }),
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: prompt
          },
          {
            role: "user",
            content: JSON.stringify({
              ...userPayload
            })
          }
        ]
      };
    const aiResult = await callOpenAiChatWithUsageGuard<OpenAiSpotPayload>({
      feature: userQuestion ? "spot_question" : "spot_diagnosis",
      userId: aiUserId,
      ticker: body.stock.ticker,
      model,
      promptVersion: diagnosisMode,
      estimatedInputTokens: Math.ceil(JSON.stringify(requestBody).length / 4),
      apiKey: process.env.OPENAI_API_KEY,
      body: requestBody
    });

    if (!aiResult.ok) {
      return NextResponse.json({ ok: true, mode: "rule", diagnosisMode, model, analysis: fallback, realtime: enrichment, ruleRisk, simulation, warning: aiResult.warning ?? `OpenAI API returned ${aiResult.status}` });
    }

    const content = aiResult.payload?.choices?.[0]?.message?.content;
    const parsed = parseAiComment(content, fallback);
    setOpenAiCache(cacheKey, { analysis: parsed, model }, spotAiCacheTtlMs);
    return NextResponse.json({ ok: true, mode: "ai", diagnosisMode, model, analysis: parsed, realtime: enrichment, ruleRisk, simulation });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 500 }
    );
  }
}

function roundForCache(value: number) {
  return Number.isFinite(value) ? Number(value.toFixed(4)) : value;
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
      marketView: marketViewOr(parsed.marketView, fallback.marketView),
      historicalPatternView: stringOr(parsed.historicalPatternView, fallback.historicalPatternView ?? ""),
      newsImpactView: stringOr(parsed.newsImpactView, fallback.newsImpactView ?? ""),
      scenarioForecast: scenarioForecastOr(parsed.scenarioForecast, fallback.scenarioForecast),
      riskFilter: stringOr(parsed.riskFilter, fallback.riskFilter ?? ""),
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
    marketView: diagnosisMode === "detailed" ? buildFallbackMarketView(realtime, ruleRisk) : undefined,
    historicalPatternView: diagnosisMode === "detailed" ? buildFallbackHistoricalPatternView(realtime) : undefined,
    newsImpactView: diagnosisMode === "detailed" ? buildFallbackNewsImpactView(realtime) : undefined,
    scenarioForecast: diagnosisMode === "detailed" ? buildFallbackScenarioForecast(input, realtime) : undefined,
    riskFilter: diagnosisMode === "detailed" ? buildFallbackRiskFilter(stock, realtime, ruleRisk) : undefined,
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
  const rawMergedPrices = mergePriceSeries(localPrices, dailyData?.prices ?? []);
  const validation = validateDailyPriceSeries(rawMergedPrices, stock.ticker);
  const mergedPrices = validation.prices.length ? validation.prices : rawMergedPrices;
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

function marketViewOr(value: unknown, fallback: AiRiskComment["marketView"]): AiRiskComment["marketView"] {
  if (!value || typeof value !== "object") return fallback;
  const row = value as Partial<NonNullable<AiRiskComment["marketView"]>>;
  const scenario = row.scenario === "upside" || row.scenario === "range" || row.scenario === "downside" ? row.scenario : fallback?.scenario;
  const confidence = row.confidence === "低" || row.confidence === "中" || row.confidence === "高" ? row.confidence : fallback?.confidence;
  const topEvidence = stringArrayOr(row.topEvidence, fallback?.topEvidence)?.slice(0, 3);
  if (!scenario || !confidence || !topEvidence?.length) return fallback;
  return { scenario, confidence, topEvidence };
}

function scenarioForecastOr(value: unknown, fallback: AiRiskComment["scenarioForecast"]): AiRiskComment["scenarioForecast"] {
  if (!value || typeof value !== "object") return fallback;
  const row = value as Partial<NonNullable<AiRiskComment["scenarioForecast"]>>;
  return {
    oneToTwoWeeks: stringOr(row.oneToTwoWeeks, fallback?.oneToTwoWeeks ?? ""),
    oneToThreeMonths: stringOr(row.oneToThreeMonths, fallback?.oneToThreeMonths ?? ""),
    upsideTrigger: stringOr(row.upsideTrigger, fallback?.upsideTrigger ?? ""),
    downsideInvalidation: stringOr(row.downsideInvalidation, fallback?.downsideInvalidation ?? ""),
    dangerLevel: stringOr(row.dangerLevel, fallback?.dangerLevel ?? "")
  };
}

function buildFallbackMarketView(realtime: Awaited<ReturnType<typeof buildRealtimeContext>>, ruleRisk: RuleRisk): NonNullable<AiRiskComment["marketView"]> {
  const currency = realtime.quote.currency === "JPY" ? "JPY" : "USD";
  const aboveMa20 = realtime.quote.price >= realtime.technical.ma20;
  const aboveMa50 = realtime.quote.price >= realtime.technical.ma50;
  const positiveNews = realtime.news.filter((item) => item.sentiment === "Positive").length;
  const negativeNews = realtime.news.filter((item) => item.sentiment === "Negative").length;
  const pattern10 = realtime.patternSimilarity.horizons.find((item) => item.days === 10);
  const scenario = aboveMa20 && aboveMa50 && positiveNews >= negativeNews
    ? "upside"
    : !aboveMa20 && negativeNews > positiveNews
      ? "downside"
      : "range";
  const confidence = ruleRisk.level === "高" || !pattern10?.sampleCount ? "低" : realtime.news.length ? "中" : "低";
  return {
    scenario,
    confidence,
    topEvidence: [
      `現在値はMA20 ${formatNative(realtime.technical.ma20, currency)}、MA50 ${formatNative(realtime.technical.ma50, currency)}との位置関係で${aboveMa20 && aboveMa50 ? "上向き" : aboveMa20 ? "中立" : "弱め"}です。`,
      pattern10?.sampleCount ? `10営業日類似は平均${formatSignedPercent(pattern10.averageReturn)}、上昇確率${pattern10.winRate.toFixed(0)}%です。` : "類似パターンのサンプルが少なく、統計根拠は限定的です。",
      realtime.news.length ? `ニュースはPositive ${positiveNews}件、Negative ${negativeNews}件で、材料の偏りを確認できます。` : "ニュースが不足しており、材料面の確認が弱いです。"
    ]
  };
}

function buildFallbackHistoricalPatternView(realtime: Awaited<ReturnType<typeof buildRealtimeContext>>) {
  const horizons = realtime.patternSimilarity.horizons
    .filter((item) => item.sampleCount)
    .map((item) => `${item.days}営業日: 平均${formatSignedPercent(item.averageReturn)} / 中央${formatSignedPercent(item.medianReturn)} / 上昇確率${item.winRate.toFixed(0)}% / 範囲${formatSignedPercent(item.minReturn)}〜${formatSignedPercent(item.maxReturn)}`)
    .join("。");
  return horizons
    ? `過去類似パターンでは、${horizons}。平均がプラスでも最小値が深い場合は、上昇期待より値幅リスクを優先して見ます。`
    : "過去類似パターンはサンプル不足です。今回の方向判断はMA、出来高、ニュース鮮度を優先します。";
}

function buildFallbackNewsImpactView(realtime: Awaited<ReturnType<typeof buildRealtimeContext>>) {
  if (!realtime.news.length) return "ニュースが十分に取得できていないため、上昇材料・下落材料の判断は低信頼です。ニュースなしではなく未取得として扱います。";
  const strongest = realtime.news.slice().sort((a, b) => b.impactScore - a.impactScore)[0];
  const positive = realtime.news.filter((item) => item.sentiment === "Positive").length;
  const negative = realtime.news.filter((item) => item.sentiment === "Negative").length;
  const bias = positive > negative ? "上昇材料寄り" : negative > positive ? "下落リスク寄り" : "中立材料寄り";
  return `取得ニュースは${bias}です。最も影響度が高い材料は「${strongest.title}」で、センチメントは${strongest.sentiment}、影響度は${strongest.impactScore}です。ただし価格に織り込み済みかは出来高と高値更新の有無で確認します。`;
}

function buildFallbackScenarioForecast(input: SpotSimulationInput, realtime: Awaited<ReturnType<typeof buildRealtimeContext>>): NonNullable<AiRiskComment["scenarioForecast"]> {
  const support = Math.min(realtime.technical.recentLow20 || realtime.quote.price, realtime.technical.ma20 || realtime.quote.price);
  const resistance = realtime.technical.recentHigh20 || realtime.quote.price;
  const nextResistance = Math.max(realtime.technical.recentHigh60 || resistance, resistance);
  return {
    oneToTwoWeeks: `${formatNative(support, input.currency)}〜${formatNative(resistance, input.currency)}のレンジ内で、出来高を伴う方向確認が優先です。`,
    oneToThreeMonths: `${formatNative(resistance, input.currency)}を維持してニュース材料が続く場合、${formatNative(nextResistance, input.currency)}再挑戦が条件付きシナリオです。`,
    upsideTrigger: `${formatNative(resistance, input.currency)}を終値で上回り、出来高倍率が1倍超を維持すること。`,
    downsideInvalidation: `${formatNative(support, input.currency)}を出来高増で割り、終値で戻せないこと。`,
    dangerLevel: formatNative(support, input.currency)
  };
}

function buildFallbackRiskFilter(stock: Stock, realtime: Awaited<ReturnType<typeof buildRealtimeContext>>, ruleRisk: RuleRisk) {
  return `最終リスクフィルターでは、Rule 1は${ruleRisk.level}リスクで元本保全を優先、Rule 2は${stock.companyName}の収益構造・利益持続性を追加確認するまで信頼度を上げすぎない、Rule 3は価格が支持線/抵抗線のどちらを抜けるか待つ忍耐が必要です。主な注意点は${ruleRisk.reasons.join("、") || "データ鮮度と執行価格のずれ"}です。`;
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

function temperatureForModel(model: string, diagnosisMode: AiDiagnosisMode) {
  if (usesDefaultTemperatureOnly(model)) return undefined;
  return diagnosisMode === "detailed" ? 0.35 : 0.2;
}

function usesDefaultTemperatureOnly(model: string) {
  const normalized = model.toLowerCase();
  return normalized.startsWith("gpt-5") || /^o\d/.test(normalized);
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
