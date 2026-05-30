import type { DailyPrice } from "@/types";

export function latestPrice(prices: DailyPrice[]) {
  return prices[prices.length - 1];
}

export function mergeLatestPrice(prices: DailyPrice[], latest?: DailyPrice | null) {
  if (!latest) return prices;
  return [...prices.filter((price) => price.date !== latest.date), latest].sort((a, b) => a.date.localeCompare(b.date));
}

export function volumeRatio(price: DailyPrice) {
  return price.volumeRatio || (price.volumeAverage > 0 ? price.volume / price.volumeAverage : 0);
}
