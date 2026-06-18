import type { DailyPrice } from "@/types";

export type DailyPriceValidationIssue = {
  code: "duplicate_date" | "invalid_date" | "weekend_date" | "future_date" | "invalid_ohlc" | "price_gap";
  date?: string;
  message: string;
};

export type DailyPriceValidationResult = {
  prices: DailyPrice[];
  issues: DailyPriceValidationIssue[];
};

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

export function mergeRealtimeDailyPrice(prices: DailyPrice[], quote: RealtimeQuoteSnapshot | null | undefined, ticker?: string) {
  if (!quote) return prices;
  const row = dailyPriceFromRealtimeQuote(prices, quote, ticker);
  if (!row) return prices;
  return mergeLatestPrice(prices, row);
}

export function dailyPriceFromRealtimeQuote(prices: DailyPrice[], quote: RealtimeQuoteSnapshot, ticker?: string): DailyPrice | null {
  const close = quote.regular.price;
  if (!Number.isFinite(close) || close <= 0) return null;

  const date = dateFromIsoInExchangeTimezone(quote.regular.asOf, ticker);
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

export function validateDailyPriceSeries(prices: DailyPrice[], ticker?: string): DailyPriceValidationResult {
  const issues: DailyPriceValidationIssue[] = [];
  const timeZone = exchangeTimeZoneForTicker(ticker);
  const exchangeToday = new Date().toLocaleDateString("en-CA", { timeZone });
  const byDate = new Map<string, DailyPrice>();

  for (const price of prices) {
    if (!isValidDateString(price.date)) {
      issues.push({ code: "invalid_date", date: price.date, message: `${price.date || "unknown"}: 日付形式が不正なため除外しました。` });
      continue;
    }
    if (price.date > exchangeToday) {
      issues.push({ code: "future_date", date: price.date, message: `${price.date}: 市場日付より未来のため除外しました。` });
      continue;
    }
    if (isWeekendDate(price.date, timeZone)) {
      issues.push({ code: "weekend_date", date: price.date, message: `${price.date}: 株式市場の週末日付のため除外しました。` });
      continue;
    }
    if (!hasValidOhlc(price)) {
      issues.push({ code: "invalid_ohlc", date: price.date, message: `${price.date}: OHLC価格の整合性が不正なため除外しました。` });
      continue;
    }
    if (byDate.has(price.date)) {
      issues.push({ code: "duplicate_date", date: price.date, message: `${price.date}: 同じ日付のデータが重複したため、後から取得した行を優先しました。` });
    }
    byDate.set(price.date, price);
  }

  const sorted = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
  const validated: DailyPrice[] = [];
  for (const price of sorted) {
    const previous = validated.at(-1);
    if (previous && isExtremeCloseJump(previous.close, price.close)) {
      issues.push({
        code: "price_gap",
        date: price.date,
        message: `${price.date}: 前営業日比で価格差が大きいため、株式分割・調整済み/未調整データの混在を確認してください。OHLCは有効なためチャートには残しています。`
      });
    }
    validated.push(normalizeDerivedPrice(price, previous));
  }

  return { prices: validated, issues };
}

function dateFromIsoInExchangeTimezone(iso: string, ticker?: string) {
  const parsed = new Date(iso);
  const timeZone = exchangeTimeZoneForTicker(ticker);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toLocaleDateString("en-CA", { timeZone });
  }
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(parsed);
}

function exchangeTimeZoneForTicker(ticker?: string) {
  return ticker && /^\d{4}\.T$/i.test(ticker) ? "Asia/Tokyo" : "America/New_York";
}

function isValidDateString(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isWeekendDate(value: string, timeZone: string) {
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(new Date(`${value}T12:00:00Z`));
  return weekday === "Sat" || weekday === "Sun";
}

function hasValidOhlc(price: DailyPrice) {
  const values = [price.open, price.high, price.low, price.close];
  if (!values.every((value) => Number.isFinite(value) && value > 0)) return false;
  return price.high >= Math.max(price.open, price.close) && price.low <= Math.min(price.open, price.close) && price.high >= price.low;
}

function isExtremeCloseJump(previousClose: number, close: number) {
  if (previousClose <= 0 || close <= 0) return false;
  const ratio = close / previousClose;
  return ratio > 3 || ratio < 0.33;
}

function normalizeDerivedPrice(price: DailyPrice, previous?: DailyPrice): DailyPrice {
  if (!previous || previous.close <= 0) return price;
  const changePercent = ((price.close - previous.close) / previous.close) * 100;
  if (Math.abs(changePercent - price.changePercent) < 0.25) return price;
  return {
    ...price,
    changePercent
  };
}

function shouldUseLivePrice(localLatest: DailyPrice | undefined, liveLatest: DailyPrice) {
  if (!localLatest) return true;
  if (liveLatest.date < localLatest.date) return false;
  if (liveLatest.date > localLatest.date) return true;
  if (localLatest.close <= 0 || liveLatest.close <= 0) return false;
  const ratio = liveLatest.close / localLatest.close;
  return ratio >= 0.5 && ratio <= 1.5;
}
