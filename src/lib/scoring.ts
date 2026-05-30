import type { DailyPrice, NewsItem, WatchStatus } from "@/types";
import { volumeRatio } from "./indicators";

export function scoreStock(price: DailyPrice, news: NewsItem[]) {
  let score = 50;
  if (price.close > price.ma20) score += 15;
  if (price.ma20 > price.ma50) score += 15;
  if (volumeRatio(price) >= 1.2) score += 10;
  if (price.rsi >= 55 && price.rsi <= 75) score += 10;
  if (price.macdDirection === "上昇") score += 10;
  if (news.some((item) => item.sentiment === "Positive")) score += 10;
  if (price.rsi > 75) score -= 15;
  if (news.some((item) => item.sentiment === "Negative")) score -= 15;
  return Math.max(0, Math.min(100, score));
}

export function statusFromScore(score: number): WatchStatus {
  if (score >= 80) return "Strong Buy";
  if (score >= 65) return "Buy";
  if (score >= 50) return "Watch";
  if (score >= 35) return "Caution";
  return "Sell";
}
