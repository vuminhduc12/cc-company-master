import type { DailyPrice } from "@/types";

export function latestPrice(prices: DailyPrice[]) {
  return prices[prices.length - 1];
}

export function mergeLatestPrice(prices: DailyPrice[], latest?: DailyPrice | null) {
  if (!latest) return prices;
  return [...prices.filter((price) => price.date !== latest.date), latest].sort((a, b) => a.date.localeCompare(b.date));
}

export function resolvePriceSeries(localPrices: DailyPrice[], livePrices?: DailyPrice[] | null, livePrice?: DailyPrice | null) {
  const localLatest = latestPrice(localPrices);
  const liveSeriesLatest = livePrices?.length ? latestPrice(livePrices) : null;
  const useLiveSeries = Boolean(livePrices?.length && liveSeriesLatest && shouldUseLivePrice(localLatest, liveSeriesLatest));
  if (useLiveSeries && livePrices) {
    return {
      prices: livePrices,
      source: "API full daily history + AI analysis",
      rejectedLive: false
    };
  }

  const safeLivePrice = livePrice && shouldUseLivePrice(localLatest, livePrice) ? livePrice : null;
  return {
    prices: mergeLatestPrice(localPrices, safeLivePrice),
    source: safeLivePrice ? "Local full history + latest AI result" : "Local verified history",
    rejectedLive: Boolean((livePrices?.length || livePrice) && !useLiveSeries && !safeLivePrice)
  };
}

export function volumeRatio(price: DailyPrice) {
  return price.volumeRatio || (price.volumeAverage > 0 ? price.volume / price.volumeAverage : 0);
}

function shouldUseLivePrice(localLatest: DailyPrice | undefined, liveLatest: DailyPrice) {
  if (!localLatest) return true;
  if (liveLatest.date < localLatest.date) return false;
  if (liveLatest.date > localLatest.date) return true;
  if (localLatest.close <= 0 || liveLatest.close <= 0) return false;
  const ratio = liveLatest.close / localLatest.close;
  return ratio >= 0.5 && ratio <= 1.5;
}
