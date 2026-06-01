import { NextResponse } from "next/server";
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
    const payload = { ...body, stock: body.stock, input: enrichedInput, simulation, realtime: enrichment, ruleRisk };
    const fallback = buildRuleBasedComment(payload, diagnosisMode);

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ ok: true, mode: "rule", diagnosisMode, analysis: fallback, realtime: enrichment, ruleRisk, simulation });
    }

    const prompt = diagnosisMode === "detailed" ? buildDetailedSystemPrompt() : buildNormalSystemPrompt();
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: diagnosisMode === "detailed" ? "gpt-5.5" : "gpt-4o-mini",
        temperature: 0.2,
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
              news: enrichment.news.slice(0, 5)
            })
          }
        ]
      })
    });

    if (!response.ok) {
      return NextResponse.json({ ok: true, mode: "rule", diagnosisMode, analysis: fallback, realtime: enrichment, ruleRisk, simulation, warning: `OpenAI API returned ${response.status}` });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    const parsed = parseAiComment(content, fallback);
    return NextResponse.json({ ok: true, mode: "ai", diagnosisMode, analysis: parsed, realtime: enrichment, ruleRisk, simulation });
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

  const comment: AiRiskComment = {
    summary: `${stock.ticker}の現物エントリー案は、診断時点価格${formatNative(realtime.quote.price, input.currency)}に対して入力エントリー価格が${formatNative(input.entryPrice, input.currency)}です。損切り時の手取り損益は${formatSignedYen(simulation.stopLoss.netPnlJpy)}、利確時の手取り損益は${formatSignedYen(simulation.takeProfit.netPnlJpy)}、リスクリワードは${rr ? rr.toFixed(2) : "-"}で、ルール判定リスクは「${ruleRisk.level}」です。`,
    dataFreshness: `価格: ${realtime.quote.source} ${formatDateTime(realtime.quote.asOf)} / 日足: ${realtime.technical.source} ${realtime.technical.latestDailyDate} / 為替: ${realtime.fx.source} ${formatDateTime(realtime.fx.asOf)}`,
    riskLevel: ruleRisk.level,
    confidence: realtime.quote.source.includes("fallback") || realtime.technical.source === "fallback" ? "低" : realtime.news.length ? "中" : "低",
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
  const latestDaily = dailyData?.prices.at(-1);
  const quote = quoteResult.status === "fulfilled"
    ? quoteResult.value
    : buildFallbackQuote(input, latestDaily, providedMetrics);
  const fx = fxResult.status === "fulfilled" ? fxResult.value : { rate: input.fxRate || 150, source: "入力値", asOf: new Date().toISOString(), ok: false };
  const technical = buildTechnicalSnapshot(dailyData?.prices ?? [], latestDaily, providedMetrics);
  const news = newsResult.status === "fulfilled" ? newsResult.value : providedNews;

  return { quote, fx, technical, news };
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
    latestDailyDate: latest?.date ?? "unknown",
    source: latest?.source ?? "fallback"
  };
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

function buildNormalSystemPrompt() {
  return [
    "You are a Japanese risk analyst for a stock cash-position simulator.",
    "Use only the JSON data provided by the application.",
    "Do not assume or invent real-time prices, news, exchange rates, or market conditions.",
    "If quote, FX, or news timestamps are stale, clearly mention the freshness limitation.",
    "Do not recommend buy, sell, hold, or specific investment action.",
    "Do not change deterministic simulation numbers or tax calculations.",
    "Explain only risk, entry price context, position sizing, exit plan, tax impact, FX impact, technical context, and news context.",
    "Return strict JSON with keys: summary, dataFreshness, riskLevel, entryPriceComment, positionSizeComment, exitPlanComment, taxComment, fxComment, technicalComment, newsComment, checklist.",
    "riskLevel must be one of: 低, 中, 高. checklist must be 3 to 5 short Japanese strings."
  ].join(" ");
}

function buildDetailedSystemPrompt() {
  return [
    "You are a senior Japanese risk analyst and trading-risk coach for a cash stock entry simulator.",
    "Write for an experienced individual investor who understands risk-reward, volatility, stop placement, liquidity, and tax impact.",
    "Use only the JSON data provided by the application.",
    "Do not browse the web.",
    "Do not assume or invent real-time prices, news, exchange rates, filings, market conditions, or company facts.",
    "Do not recommend buy, sell, hold, entry, exit, or position changes as investment advice. You may give risk-management advice such as what to verify, what would invalidate the plan, and what conditions would make the plan fragile.",
    "Do not change deterministic simulation numbers, tax calculations, FX conversion, ruleRisk, or scenario table values.",
    "Your job is to stress-test the user's entry plan, identify weak assumptions, and give advanced, data-grounded risk-management advice in Japanese.",
    "Be specific and numerical whenever the supplied data supports it. Reference exact levels, percentages, risk-reward, ATR%, stop-loss loss, take-profit net profit, FX rate, RSI, MA20, MA50, volume ratio, data age, and ruleRisk reasons.",
    "Use a professional but direct tone. Avoid generic advice. Every major point must connect to supplied data.",
    "Analyze entry price quality versus quote: premium/discount to current quote, whether the entry assumption is stale, and how the plan changes if execution price slips.",
    "Analyze position sizing: position value, stop-loss net loss, loss percentage versus position value, concentration risk, and whether the scenario is sensitive to small price moves. Do not prescribe a specific share count.",
    "Analyze exit-plan quality: take-profit, stop-loss, risk-reward, whether the stop is realistic versus ATR/volatility, and whether the plan depends too much on perfect execution.",
    "Analyze technical context: RSI, MA20, MA50, volume ratio, ATR%, trend alignment, overheat risk, breakdown risk, and volatility regime.",
    "Analyze execution risks: opening gaps, after-hours moves, spread widening, low liquidity, small-cap volatility, and the possibility that stop-loss execution differs from the modeled stop price.",
    "Analyze FX risk for USD stocks: explain how USD/JPY affects JPY profit/loss and whether FX is a secondary or material driver based on the position value.",
    "Analyze tax/account type: explain taxable account versus NISA impact, net-of-tax outcome, and NISA loss-offset limitation when relevant. Do not provide legal or tax advice.",
    "Analyze news and data quality: news count, timestamp/freshness, missing news, fallback data, quote age, daily data age, and whether confidence should be reduced.",
    "Provide decision-support advice only: define what should be checked before acting, what would invalidate the scenario, and what risk the user is accepting. Do not say the user should enter, buy, sell, hold, or avoid.",
    "If data is stale, missing, fallback, or incomplete, explicitly lower confidence and explain why.",
    "Return strict JSON in Japanese with keys: summary, dataFreshness, riskLevel, confidence, entryPriceComment, positionSizeComment, exitPlanComment, taxComment, fxComment, technicalComment, newsComment, stressTest, blindSpots, checklist.",
    "riskLevel and confidence must be one of: 低, 中, 高.",
    "summary must be concise but include the dominant risk, not only a restatement of numbers.",
    "entryPriceComment, positionSizeComment, exitPlanComment, technicalComment, and newsComment should each contain practical advice based on the data.",
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
    priceSource: realtime.quote.source,
    fxSource: realtime.fx.source,
    dailySource: realtime.technical.source,
    latestDailyDate: realtime.technical.latestDailyDate,
    hasRealtimeQuoteFallback: realtime.quote.source.includes("fallback"),
    hasFxFallback: !realtime.fx.ok
  };
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
