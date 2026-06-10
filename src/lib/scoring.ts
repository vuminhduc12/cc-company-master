import type { DailyPrice, NewsItem, ScoreFactor, StockScoreAnalysis, WatchStatus } from "@/types";
import { volumeRatio } from "./indicators";

export function analyzeStock(price: DailyPrice, news: NewsItem[]): StockScoreAnalysis {
  const factors = [
    ...trendFactors(price),
    ...momentumFactors(price),
    ...volumeFactors(price),
    ...riskFactors(price),
    ...newsFactors(news)
  ];
  const rawScore = 50 + factors.reduce((sum, factor) => sum + factor.points, 0);
  const score = clamp(Math.round(rawScore), 0, 100);
  const status = statusFromScore(score);
  const positivePoints = factors.filter((factor) => factor.points > 0).sort((a, b) => b.points - a.points);
  const negativePoints = factors.filter((factor) => factor.points < 0).sort((a, b) => a.points - b.points);

  return {
    score,
    status,
    factors,
    positivePoints,
    negativePoints,
    summary: buildSummary(score, status, positivePoints, negativePoints)
  };
}

export function scoreStock(price: DailyPrice, news: NewsItem[]) {
  return analyzeStock(price, news).score;
}

export function statusFromScore(score: number): WatchStatus {
  if (score >= 80) return "Strong Buy";
  if (score >= 65) return "Buy";
  if (score >= 50) return "Watch";
  if (score >= 35) return "Caution";
  return "Sell";
}

function trendFactors(price: DailyPrice) {
  const factors: ScoreFactor[] = [];
  const ma20Gap = price.ma20 > 0 ? ((price.close - price.ma20) / price.ma20) * 100 : 0;
  const ma50Gap = price.ma50 > 0 ? ((price.close - price.ma50) / price.ma50) * 100 : 0;
  const trendGap = price.ma50 > 0 ? ((price.ma20 - price.ma50) / price.ma50) * 100 : 0;

  factors.push(factor(
    "価格とMA20",
    ma20Gap >= 8 ? 12 : ma20Gap >= 2 ? 8 : ma20Gap >= 0 ? 4 : ma20Gap > -5 ? -6 : -12,
    `終値はMA20から${formatPercent(ma20Gap)}。短期トレンドの位置を評価。`
  ));
  factors.push(factor(
    "MA20とMA50",
    trendGap >= 8 ? 10 : trendGap >= 2 ? 7 : trendGap >= 0 ? 3 : trendGap > -5 ? -6 : -10,
    `MA20はMA50から${formatPercent(trendGap)}。中期トレンドの傾きを評価。`
  ));
  factors.push(factor(
    "価格とMA50",
    ma50Gap >= 15 ? 6 : ma50Gap >= 3 ? 4 : ma50Gap >= 0 ? 1 : ma50Gap > -8 ? -4 : -8,
    `終値はMA50から${formatPercent(ma50Gap)}。大きな流れからの距離を評価。`
  ));

  return factors;
}

function momentumFactors(price: DailyPrice) {
  const factors: ScoreFactor[] = [];
  const rsi = price.rsi;

  factors.push(factor(
    "RSI",
    rsi >= 45 && rsi <= 65 ? 9 : rsi > 65 && rsi <= 72 ? 4 : rsi > 72 ? -8 : rsi >= 35 ? 1 : -10,
    `RSIは${rsi.toFixed(1)}。45〜65は健全、72超は過熱、35未満は弱さとして評価。`
  ));
  factors.push(factor(
    "MACD",
    price.macdDirection === "上昇" && price.macdHistogram >= 0 ? 7 : price.macdDirection === "上昇" ? 4 : -6,
    `MACD方向は${price.macdDirection}、ヒストグラムは${price.macdHistogram.toFixed(2)}。勢いの変化を評価。`
  ));
  factors.push(factor(
    "日次変化率",
    price.changePercent >= 12 ? 3 : price.changePercent >= 2 ? 5 : price.changePercent > -4 ? 0 : price.changePercent > -10 ? -5 : -10,
    `前日比は${formatPercent(price.changePercent)}。急騰は加点を抑え、急落はリスクとして評価。`
  ));

  return factors;
}

function volumeFactors(price: DailyPrice) {
  const ratio = volumeRatio(price);
  return [
    factor(
      "出来高倍率",
      ratio >= 2.5 ? 9 : ratio >= 1.5 ? 7 : ratio >= 1.1 ? 3 : ratio >= 0.75 ? 0 : -6,
      `出来高倍率は${ratio.toFixed(2)}x。価格変化に参加者が伴っているかを評価。`
    ),
    factor(
      "値幅",
      price.intradayRangePercent >= 18 ? -8 : price.intradayRangePercent >= 10 ? -3 : 2,
      `日中値幅は${formatPercent(price.intradayRangePercent)}。大きすぎる値幅は荒さとして減点。`
    )
  ];
}

function riskFactors(price: DailyPrice) {
  const factors: ScoreFactor[] = [];

  if (price.high20Breakout) {
    factors.push(factor("20日高値", 6, "20日高値更新。短期資金流入の候補として評価。"));
  }
  if (price.close < price.ma20 && price.macdDirection === "低下") {
    factors.push(factor("失速リスク", -10, "終値がMA20を下回り、MACDも低下。短期失速リスクとして評価。"));
  }
  if (price.rsi >= 75 && volumeRatio(price) >= 1.5) {
    factors.push(factor("過熱リスク", -8, "RSI高止まりかつ出来高急増。短期利確売りを警戒。"));
  }
  if (price.pattern.includes("リスク") || price.rsiSignal.includes("弱気")) {
    factors.push(factor("弱気シグナル", -7, `パターン/RSI判定: ${price.pattern || price.rsiSignal}`));
  }

  return factors;
}

function newsFactors(news: NewsItem[]) {
  const positiveImpact = news.filter((item) => item.sentiment === "Positive").reduce((sum, item) => sum + item.impactScore, 0);
  const negativeImpact = news.filter((item) => item.sentiment === "Negative").reduce((sum, item) => sum + item.impactScore, 0);
  const netImpact = positiveImpact - negativeImpact;

  if (netImpact >= 12) return [factor("ニュース材料", 10, `Positive材料が優勢。ニュース影響度ネットは+${netImpact}。`)];
  if (netImpact >= 5) return [factor("ニュース材料", 5, `Positive材料がやや優勢。ニュース影響度ネットは+${netImpact}。`)];
  if (netImpact <= -12) return [factor("ニュース材料", -12, `Negative材料が優勢。ニュース影響度ネットは${netImpact}。`)];
  if (netImpact <= -5) return [factor("ニュース材料", -6, `Negative材料がやや優勢。ニュース影響度ネットは${netImpact}。`)];
  return [factor("ニュース材料", 0, "ニュース材料は中立または影響不明。")];
}

function factor(label: string, points: number, detail: string): ScoreFactor {
  return {
    label,
    points,
    detail,
    tone: points > 0 ? "positive" : points < 0 ? "negative" : "neutral"
  };
}

function buildSummary(score: number, status: WatchStatus, positive: ScoreFactor[], negative: ScoreFactor[]) {
  const topPositive = positive[0]?.label ?? "明確な強材料なし";
  const topNegative = negative[0]?.label ?? "大きな弱材料なし";
  return `総合スコア${score}点、判定は${status}。主な強材料は「${topPositive}」、主な注意材料は「${topNegative}」です。`;
}

function formatPercent(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
