import type { DailyPrice } from "@/types";

export type RealtimeQuoteSnapshot = {
  regular: {
    price: number;
    previousClose: number | null;
    change: number | null;
    changePercent: number | null;
    asOf: string;
  };
  source?: string;
};

export function latestPrice(prices: DailyPrice[]) {
  return prices[prices.length - 1];
}

export function mergeLatestPrice(prices: DailyPrice[], latest?: DailyPrice | null) {
  if (!latest) return prices;
  return [...prices.filter((price) => price.date !== latest.date), latest].sort((a, b) => a.date.localeCompare(b.date));
}

export function mergePriceSeries(localPrices: DailyPrice[], livePrices?: DailyPrice[] | null) {
  if (!livePrices?.length) return localPrices;
  const byDate = new Map(localPrices.map((price) => [price.date, price]));
  for (const price of livePrices) {
    byDate.set(price.date, price);
  }
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

export function mergeRealtimeDailyPrice(prices: DailyPrice[], quote: RealtimeQuoteSnapshot | null | undefined) {
  if (!quote) return prices;
  const row = dailyPriceFromRealtimeQuote(prices, quote);
  if (!row) return prices;
  return mergeLatestPrice(prices, row);
}

export function dailyPriceFromRealtimeQuote(prices: DailyPrice[], quote: RealtimeQuoteSnapshot): DailyPrice | null {
  const close = quote.regular.price;
  if (!Number.isFinite(close) || close <= 0) return null;

  const date = dateFromIsoInTokyo(quote.regular.asOf);
  const previous = latestPrice(prices);
  if (previous && date < previous.date) return null;

  const previousClose = quote.regular.previousClose ?? previous?.close ?? close;
  const changePercent = quote.regular.changePercent ?? (previousClose > 0 ? ((close - previousClose) / previousClose) * 100 : 0);
  const existingSameDay = prices.find((price) => price.date === date);
  const open = existingSameDay?.open ?? (previous?.date === date ? previous.open : previousClose);
  const high = Math.max(close, open, existingSameDay?.high ?? close);
  const low = Math.min(close, open, existingSameDay?.low ?? close);
  const template = existingSameDay ?? previous;

  return {
    date,
    open,
    high,
    low,
    close,
    volume: template?.volume ?? 0,
    changePercent,
    volumeAverage20: template?.volumeAverage20 ?? 0,
    volumeRatio: template?.volumeRatio ?? 0,
    intradayRangePercent: previousClose > 0 ? ((high - low) / previousClose) * 100 : 0,
    rsi: template?.rsi ?? 50,
    macd: template?.macd ?? 0,
    macdSignal: template?.macdSignal ?? 0,
    macdHistogram: template?.macdHistogram ?? 0,
    macdDirection: changePercent >= 0 ? "上昇" : "低下",
    rsiSignal: template?.rsiSignal ?? "中立",
    high20Breakout: template?.high20Breakout ?? "",
    ma5: template?.ma5 ?? close,
    ma20: template?.ma20 ?? close,
    ma50: template?.ma50 ?? close,
    volumeAverage: template?.volumeAverage ?? 0,
    closeAfter5Days: null,
    changeAfter5Days: null,
    closeAfter10Days: null,
    changeAfter10Days: null,
    score: template?.score ?? 4,
    pattern: existingSameDay?.pattern ?? "リアルタイム更新",
    comment: "リアルタイム株価を日次表に反映しています。",
    source: quote.source ?? "Yahoo Finance realtime"
  };
}

export function resolvePriceSeries(localPrices: DailyPrice[], livePrices?: DailyPrice[] | null, livePrice?: DailyPrice | null) {
  const localLatest = latestPrice(localPrices);
  const liveSeriesLatest = livePrices?.length ? latestPrice(livePrices) : null;
  const useLiveSeries = Boolean(livePrices?.length && liveSeriesLatest && shouldUseLivePrice(localLatest, liveSeriesLatest));
  if (useLiveSeries && livePrices) {
    return {
      prices: mergePriceSeries(localPrices, livePrices),
      source: "Local full history + API latest daily history",
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

function dateFromIsoInTokyo(iso: string) {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo" });
  }
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(parsed);
}

function shouldUseLivePrice(localLatest: DailyPrice | undefined, liveLatest: DailyPrice) {
  if (!localLatest) return true;
  if (liveLatest.date < localLatest.date) return false;
  if (liveLatest.date > localLatest.date) return true;
  if (localLatest.close <= 0 || liveLatest.close <= 0) return false;
  const ratio = liveLatest.close / localLatest.close;
  return ratio >= 0.5 && ratio <= 1.5;
}
