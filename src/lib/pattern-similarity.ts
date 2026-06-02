import type { DailyPrice } from "@/types";

export type PatternHorizon = {
  days: 5 | 10 | 20;
  sampleCount: number;
  averageReturn: number;
  medianReturn: number;
  winRate: number;
  maxReturn: number;
  minReturn: number;
};

export type SimilarPatternMatch = {
  date: string;
  close: number;
  similarity: number;
  rsi: number;
  volumeRatio: number;
  changePercent: number;
  ma20Gap: number;
  ma50Gap: number;
  trendGap: number;
  macdDirection: DailyPrice["macdDirection"];
  high20Breakout: boolean;
  return5: number | null;
  return10: number | null;
  return20: number | null;
};

export type PatternSimilarityResult = {
  currentDate: string;
  currentClose: number;
  sampleCount: number;
  matches: SimilarPatternMatch[];
  horizons: PatternHorizon[];
  summary: string;
  caveat: string;
};

type FeatureVector = {
  rsi: number;
  volumeRatio: number;
  changePercent: number;
  ma20Gap: number;
  ma50Gap: number;
  trendGap: number;
  macdUp: number;
  high20Breakout: number;
  intradayRangePercent: number;
};

const horizons = [5, 10, 20] as const;

export function analyzePatternSimilarity(prices: DailyPrice[], matchLimit = 12): PatternSimilarityResult {
  const validPrices = prices.filter((price) => price.close > 0);
  const currentIndex = validPrices.length - 1;
  const current = validPrices[currentIndex];
  if (!current || validPrices.length < 80) {
    return {
      currentDate: current?.date ?? "",
      currentClose: current?.close ?? 0,
      sampleCount: 0,
      matches: [],
      horizons: horizons.map((days) => emptyHorizon(days)),
      summary: "類似パターン分析に必要な過去データが不足しています。",
      caveat: "過去パターンは将来の値動きを保証しません。"
    };
  }

  const currentVector = toFeatureVector(current);
  const candidates = validPrices.slice(50, currentIndex - 20).map((price, index) => {
    const actualIndex = index + 50;
    return {
      price,
      index: actualIndex,
      distance: vectorDistance(currentVector, toFeatureVector(price))
    };
  });
  const matches = candidates
    .sort((a, b) => a.distance - b.distance)
    .slice(0, matchLimit)
    .map(({ price, index, distance }): SimilarPatternMatch => ({
      date: price.date,
      close: price.close,
      similarity: Math.max(0, 100 - distance * 100),
      rsi: price.rsi,
      volumeRatio: price.volumeRatio,
      changePercent: price.changePercent,
      ma20Gap: percentGap(price.close, price.ma20),
      ma50Gap: percentGap(price.close, price.ma50),
      trendGap: percentGap(price.ma20, price.ma50),
      macdDirection: price.macdDirection,
      high20Breakout: Boolean(price.high20Breakout),
      return5: forwardReturn(validPrices, index, 5),
      return10: forwardReturn(validPrices, index, 10),
      return20: forwardReturn(validPrices, index, 20)
    }));
  const resultHorizons = horizons.map((days) => buildHorizon(matches, days));

  return {
    currentDate: current.date,
    currentClose: current.close,
    sampleCount: matches.length,
    matches,
    horizons: resultHorizons,
    summary: buildSummary(resultHorizons),
    caveat: "過去類似パターンは確率的な参考材料であり、ニュース、決算、地合い、流動性の変化で結果は大きく変わります。"
  };
}

function toFeatureVector(price: DailyPrice): FeatureVector {
  return {
    rsi: normalize(price.rsi, 0, 100),
    volumeRatio: normalize(Math.min(price.volumeRatio, 5), 0, 5),
    changePercent: normalize(clamp(price.changePercent, -20, 20), -20, 20),
    ma20Gap: normalize(clamp(percentGap(price.close, price.ma20), -30, 30), -30, 30),
    ma50Gap: normalize(clamp(percentGap(price.close, price.ma50), -40, 40), -40, 40),
    trendGap: normalize(clamp(percentGap(price.ma20, price.ma50), -30, 30), -30, 30),
    macdUp: price.macdDirection === "上昇" ? 1 : 0,
    high20Breakout: price.high20Breakout ? 1 : 0,
    intradayRangePercent: normalize(clamp(price.intradayRangePercent, 0, 25), 0, 25)
  };
}

function vectorDistance(a: FeatureVector, b: FeatureVector) {
  const weights: Record<keyof FeatureVector, number> = {
    rsi: 1.2,
    volumeRatio: 1.25,
    changePercent: 0.8,
    ma20Gap: 1.35,
    ma50Gap: 1.0,
    trendGap: 1.1,
    macdUp: 0.75,
    high20Breakout: 0.9,
    intradayRangePercent: 0.75
  };
  const totalWeight = Object.values(weights).reduce((sum, value) => sum + value, 0);
  const weighted = (Object.keys(weights) as Array<keyof FeatureVector>).reduce((sum, key) => {
    const diff = a[key] - b[key];
    return sum + Math.abs(diff) * weights[key];
  }, 0);
  return weighted / totalWeight;
}

function buildHorizon(matches: SimilarPatternMatch[], days: 5 | 10 | 20): PatternHorizon {
  const key = `return${days}` as const;
  const returns = matches.map((match) => match[key]).filter((value): value is number => Number.isFinite(value));
  if (!returns.length) return emptyHorizon(days);

  return {
    days,
    sampleCount: returns.length,
    averageReturn: average(returns),
    medianReturn: median(returns),
    winRate: returns.filter((value) => value > 0).length / returns.length * 100,
    maxReturn: Math.max(...returns),
    minReturn: Math.min(...returns)
  };
}

function emptyHorizon(days: 5 | 10 | 20): PatternHorizon {
  return {
    days,
    sampleCount: 0,
    averageReturn: 0,
    medianReturn: 0,
    winRate: 0,
    maxReturn: 0,
    minReturn: 0
  };
}

function buildSummary(items: PatternHorizon[]) {
  const horizon10 = items.find((item) => item.days === 10);
  const horizon20 = items.find((item) => item.days === 20);
  if (!horizon10 || horizon10.sampleCount === 0) return "類似パターンの集計対象が不足しています。";
  const direction = horizon10.averageReturn > 3 ? "短期上昇寄り" : horizon10.averageReturn < -3 ? "短期下落寄り" : "短期は中立";
  const volatility = horizon20 && Math.abs(horizon20.maxReturn - horizon20.minReturn) >= 25 ? "ただし20営業日では値幅が大きく、反落リスクも残ります。" : "20営業日でも極端なばらつきは限定的です。";
  return `過去類似では10営業日平均が${formatPercent(horizon10.averageReturn)}、上昇確率が${horizon10.winRate.toFixed(0)}%で、傾向は${direction}です。${volatility}`;
}

function forwardReturn(prices: DailyPrice[], index: number, days: number) {
  const current = prices[index];
  const future = prices[index + days];
  if (!current || !future || current.close <= 0) return null;
  return (future.close - current.close) / current.close * 100;
}

function percentGap(value: number, base: number) {
  if (!base || base <= 0) return 0;
  return (value - base) / base * 100;
}

function normalize(value: number, min: number, max: number) {
  if (max === min) return 0;
  return (value - min) / (max - min);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]) {
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function formatPercent(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}
