import type { DailyPrice, NewsItem } from "@/types";

export type LargeMoneyFlowPhase = "Accumulation" | "Breakout" | "Distribution" | "No Signal";

export type LargeMoneyFlowSignal = {
  score: number;
  phase: LargeMoneyFlowPhase;
  confidence: "低" | "中" | "高";
  summary: string;
  evidence: string[];
  warnings: string[];
};

export function analyzeLargeMoneyFlow(prices: DailyPrice[], news: Pick<NewsItem, "sentiment" | "impactScore">[] = []): LargeMoneyFlowSignal {
  const latest = prices.at(-1);
  if (!latest || prices.length < 10) {
    return {
      score: 0,
      phase: "No Signal",
      confidence: "低",
      summary: "大口資金シグナルを判定するには日足データが不足しています。",
      evidence: [],
      warnings: ["日足10本以上が必要です。"]
    };
  }

  const previous20 = prices.slice(-21, -1);
  const recent5 = prices.slice(-5);
  const high20BeforeLatest = maxBy(previous20, "high", latest.high);
  const low20BeforeLatest = minBy(previous20, "low", latest.low);
  const closeLocation = dayCloseLocation(latest);
  const volumeRatio = safeNumber(latest.volumeRatio);
  const rangePercent = safeNumber(latest.intradayRangePercent);
  const highVolumeDays = recent5.filter((price) => safeNumber(price.volumeRatio) >= 1.2).length;
  const positiveNews = news.some((item) => item.sentiment === "Positive" && item.impactScore >= 7);
  const negativeNews = news.some((item) => item.sentiment === "Negative" && item.impactScore >= 7);

  const evidence: string[] = [];
  const warnings: string[] = [];
  let score = 0;

  if (volumeRatio >= 2.5) add(22, `出来高倍率が${volumeRatio.toFixed(2)}xで、通常よりかなり大きい参加があります。`);
  else if (volumeRatio >= 1.5) add(16, `出来高倍率が${volumeRatio.toFixed(2)}xで、資金流入候補です。`);
  else if (volumeRatio >= 1.1) add(6, `出来高倍率が${volumeRatio.toFixed(2)}xで、参加はやや増えています。`);

  if (closeLocation >= 0.75 && latest.changePercent > 0) add(16, "終値が日中高値圏で、買いが引けまで残った形です。");
  if (latest.close > high20BeforeLatest && volumeRatio >= 1.2) add(18, "直近20日高値を出来高を伴って上抜けています。");
  if (latest.close > latest.ma20 && latest.ma20 >= latest.ma50) add(10, "終値がMA20上、MA20もMA50以上で、トレンドが崩れていません。");
  if (highVolumeDays >= 3) add(10, `直近5日中${highVolumeDays}日で出来高が平均超えです。継続的な参加を示します。`);
  if (positiveNews && latest.changePercent >= 0) add(8, "強いPositiveニュース後も価格が維持されており、材料への買い反応があります。");
  if (negativeNews && latest.changePercent >= 0) add(8, "Negativeニュースでも価格が崩れておらず、売り吸収の可能性があります。");
  if (volumeRatio >= 1.5 && Math.abs(latest.changePercent) <= 2 && closeLocation >= 0.55) add(8, "出来高増でも価格が大きく崩れず、吸収・仕込み候補です。");

  if (volumeRatio >= 1.5 && closeLocation <= 0.25 && latest.changePercent < 0) {
    score -= 28;
    warnings.push("出来高増で終値が安値圏です。大口買いではなく売り抜け・分配の可能性があります。");
  }
  if (latest.close < low20BeforeLatest && volumeRatio >= 1.2) {
    score -= 20;
    warnings.push("直近20日安値を出来高を伴って下抜けています。資金流出を警戒します。");
  }
  if (rangePercent >= 12 && closeLocation < 0.5) {
    score -= 10;
    warnings.push("値幅が大きいのに終値が強くなく、上値の売り圧力に注意が必要です。");
  }

  const phase = resolvePhase(score, latest, high20BeforeLatest, volumeRatio, closeLocation);
  const confidence = prices.length >= 60 && volumeRatio >= 1.2 ? "高" : prices.length >= 30 ? "中" : "低";
  const normalizedScore = clamp(Math.round(score), 0, 100);

  return {
    score: normalizedScore,
    phase,
    confidence,
    summary: buildSummary(phase, normalizedScore),
    evidence: evidence.slice(0, 5),
    warnings: warnings.slice(0, 4)
  };

  function add(points: number, detail: string) {
    score += points;
    evidence.push(detail);
  }
}

function resolvePhase(score: number, latest: DailyPrice, high20BeforeLatest: number, volumeRatio: number, closeLocation: number): LargeMoneyFlowPhase {
  if (score < 20) {
    if (volumeRatio >= 1.5 && closeLocation <= 0.25 && latest.changePercent < 0) return "Distribution";
    return "No Signal";
  }
  if (latest.close > high20BeforeLatest && volumeRatio >= 1.2 && score >= 45) return "Breakout";
  if (volumeRatio >= 1.2 && closeLocation >= 0.45 && score >= 32) return "Accumulation";
  return score >= 45 ? "Accumulation" : "No Signal";
}

function buildSummary(phase: LargeMoneyFlowPhase, score: number) {
  if (phase === "Breakout") return `大口資金を伴うブレイク候補です。シグナルは${score}/100です。`;
  if (phase === "Accumulation") return `資金流入・仕込みの可能性があります。シグナルは${score}/100です。`;
  if (phase === "Distribution") return `出来高増の売り抜け・分配を警戒します。シグナルは${score}/100です。`;
  return `明確な大口資金シグナルは限定的です。シグナルは${score}/100です。`;
}

function dayCloseLocation(price: DailyPrice) {
  const range = price.high - price.low;
  if (!Number.isFinite(range) || range <= 0) return 0.5;
  return clamp((price.close - price.low) / range, 0, 1);
}

function maxBy(rows: DailyPrice[], key: "high" | "low", fallback: number) {
  if (!rows.length) return fallback;
  return Math.max(...rows.map((row) => row[key]).filter(Number.isFinite));
}

function minBy(rows: DailyPrice[], key: "high" | "low", fallback: number) {
  if (!rows.length) return fallback;
  return Math.min(...rows.map((row) => row[key]).filter(Number.isFinite));
}

function safeNumber(value: number) {
  return Number.isFinite(value) ? value : 0;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
