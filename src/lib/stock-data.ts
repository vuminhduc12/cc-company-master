import { getPricesForTicker } from "@/lib/mock-data";
import type { DailyPrice } from "@/types";

type RawDailyPrice = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type StockDataMode = "live" | "mock";
type StockDataProvider = "yahoo" | "alpha_vantage";
type FetchAttempt = {
  result: StockDataResult | null;
  error?: string;
};

export type StockDataResult = {
  prices: DailyPrice[];
  mode: StockDataMode;
  provider: StockDataProvider | "local";
  warning?: string;
};

export async function fetchStockData(ticker: string): Promise<StockDataResult> {
  const provider = normalizeProvider(process.env.STOCK_DATA_PROVIDER);
  const fallback = getPricesForTicker(ticker);
  const warnings: string[] = [];
  const errors: string[] = [];

  if (provider === "yahoo") {
    const yahooAttempt = await tryFetchYahooFinanceStockData(ticker);
    if (yahooAttempt.result) return yahooAttempt.result;
    if (yahooAttempt.error) errors.push(`Yahoo Finance: ${yahooAttempt.error}`);
    warnings.push(`${ticker}: Yahoo Financeから日足データを取得できませんでした。`);

    const alphaAttempt = await tryFetchAlphaVantageStockData(ticker);
    if (alphaAttempt.result) {
      return withWarning(alphaAttempt.result, warnings.join(" "));
    }
    if (alphaAttempt.error) errors.push(`Alpha Vantage: ${alphaAttempt.error}`);
  } else {
    const alphaAttempt = await tryFetchAlphaVantageStockData(ticker);
    if (alphaAttempt.result) return alphaAttempt.result;
    if (alphaAttempt.error) errors.push(`Alpha Vantage: ${alphaAttempt.error}`);
    warnings.push(`${ticker}: Alpha Vantageから日足データを取得できませんでした。`);

    const yahooAttempt = await tryFetchYahooFinanceStockData(ticker);
    if (yahooAttempt.result) {
      return withWarning(yahooAttempt.result, warnings.join(" "));
    }
    if (yahooAttempt.error) errors.push(`Yahoo Finance: ${yahooAttempt.error}`);
  }

  if (fallback) {
    return {
      prices: fallback,
      mode: "mock",
      provider: "local",
      warning: [...warnings, `${ticker}: ローカル履歴データを表示しています。`].join(" ")
    };
  }

  const details = errors.length > 0 ? ` 詳細: ${errors.join(" / ")}` : "";
  const marketHint = /^\d{4}\.T$/i.test(ticker)
    ? " 国内株は東証上場の4桁コードを想定しています。銘柄コードが東証に存在するか確認してください。"
    : "";
  throw new Error(`${ticker}: 株価データを取得できませんでした。Yahoo Finance、Alpha Vantage、ローカル履歴のいずれにも有効な日足がありません。${marketHint}${details}`);
}

function normalizeProvider(value: string | undefined): StockDataProvider {
  return value === "alpha_vantage" ? "alpha_vantage" : "yahoo";
}

async function tryFetchYahooFinanceStockData(ticker: string): Promise<FetchAttempt> {
  try {
    return { result: await fetchYahooFinanceStockData(ticker) };
  } catch (error) {
    return { result: null, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

async function fetchYahooFinanceStockData(ticker: string): Promise<StockDataResult> {
  const symbol = normalizeYahooSymbol(ticker);
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1y&interval=1d`;
  const response = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0" },
    next: { revalidate: 0 }
  });
  if (!response.ok) throw new Error(`Yahoo Finance API error: ${response.status}`);

  const payload = await response.json() as {
    chart?: {
      result?: Array<{
        timestamp?: number[];
        indicators?: {
          quote?: Array<{
            open?: Array<number | null>;
            high?: Array<number | null>;
            low?: Array<number | null>;
            close?: Array<number | null>;
            volume?: Array<number | null>;
          }>;
        };
      }>;
      error?: { description?: string };
    };
  };
  const result = payload.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  if (!result?.timestamp || !quote) {
    throw new Error(`${ticker}: Yahoo Financeの日足データを取得できませんでした。${payload.chart?.error?.description ?? ""}`);
  }

  const rows = result.timestamp.map((timestamp, index) => ({
    date: new Date(timestamp * 1000).toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo" }),
    open: Number(quote.open?.[index]),
    high: Number(quote.high?.[index]),
    low: Number(quote.low?.[index]),
    close: Number(quote.close?.[index]),
    volume: Number(quote.volume?.[index] ?? 0)
  })).filter(isValidRawDailyPrice);
  if (rows.length === 0) throw new Error(`${ticker}: Yahoo Financeのレスポンスに有効な日足データがありません。`);

  return {
    prices: rows.map((row, index) => buildDailyPrice(rows, row, index, "Yahoo Finance")),
    mode: "live",
    provider: "yahoo",
    warning: symbol !== ticker ? `${ticker} は ${symbol} としてYahoo Financeから取得しました。` : undefined
  };
}

async function tryFetchAlphaVantageStockData(ticker: string): Promise<FetchAttempt> {
  const key = process.env.STOCK_API_KEY;
  if (!key) return { result: null, error: "STOCK_API_KEYが未設定です。" };

  try {
    return { result: await fetchAlphaVantageStockData(ticker, key) };
  } catch (error) {
    return { result: null, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

async function fetchAlphaVantageStockData(ticker: string, key: string): Promise<StockDataResult> {
  const symbol = normalizeAlphaVantageSymbol(ticker);
  const url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(symbol)}&apikey=${key}&outputsize=full`;
  const response = await fetch(url, { next: { revalidate: 0 } });
  if (!response.ok) throw new Error(`Alpha Vantage API error: ${response.status}`);

  const payload = await response.json() as {
    ["Time Series (Daily)"]?: Record<string, Record<string, string>>;
    Note?: string;
    Information?: string;
    Error?: string;
    ["Error Message"]?: string;
  };
  const series = payload["Time Series (Daily)"];
  if (!series) {
    throw new Error(normalizeAlphaVantageMessage(payload.Note ?? payload.Information ?? payload.Error ?? payload["Error Message"], ticker, symbol));
  }

  const rows = Object.entries(series).reverse().map(([date, row]) => ({
    date,
    open: Number(row["1. open"]),
    high: Number(row["2. high"]),
    low: Number(row["3. low"]),
    close: Number(row["4. close"]),
    volume: Number(row["5. volume"])
  })).filter(isValidRawDailyPrice);
  if (rows.length === 0) throw new Error(`${ticker}: Alpha Vantageのレスポンスに有効な日足データがありません。`);

  return {
    prices: rows.map((row, index) => buildDailyPrice(rows, row, index, "Alpha Vantage")),
    mode: "live",
    provider: "alpha_vantage",
    warning: symbol !== ticker ? `${ticker} は ${symbol} としてAlpha Vantageから取得しました。` : undefined
  };
}

function withWarning(result: StockDataResult, warning: string): StockDataResult {
  if (!warning) return result;
  return {
    ...result,
    warning: result.warning ? `${warning} ${result.warning}` : warning
  };
}

function isValidRawDailyPrice(row: RawDailyPrice) {
  return Boolean(row.date)
    && Number.isFinite(row.open)
    && Number.isFinite(row.high)
    && Number.isFinite(row.low)
    && Number.isFinite(row.close)
    && row.close > 0
    && Number.isFinite(row.volume);
}

function normalizeAlphaVantageSymbol(ticker: string) {
  if (/^\d{4}$/.test(ticker)) return `${ticker}.T`;
  if (/^\d{4}\.JP$/i.test(ticker)) return ticker.replace(/\.JP$/i, ".T");
  return ticker;
}

function normalizeYahooSymbol(ticker: string) {
  if (/^\d{4}$/.test(ticker)) return `${ticker}.T`;
  if (/^\d{4}\.JP$/i.test(ticker)) return ticker.replace(/\.JP$/i, ".T");
  return ticker;
}

function normalizeAlphaVantageMessage(message: string | undefined, ticker: string, symbol: string) {
  if (!message) {
    return `${ticker}: Alpha Vantageから日足データを取得できませんでした。実際に試したシンボルは ${symbol} です。`;
  }
  const lower = message.toLowerCase();
  if (lower.includes("rate limit") || lower.includes("free api requests") || lower.includes("standard api rate limit") || lower.includes("premium")) {
    return `${ticker}: Alpha Vantage無料枠の制限に達しています。詳細: ${message}`;
  }
  if (lower.includes("api key") || lower.includes("apikey")) {
    return `${ticker}: STOCK_API_KEYが無効、または未反映の可能性があります。詳細: ${message}`;
  }
  return `${ticker}: ${message}`;
}

function buildDailyPrice(rows: RawDailyPrice[], row: RawDailyPrice, index: number, source: string): DailyPrice {
  const closes = rows.slice(0, index + 1).map((item) => item.close);
  const previousCloses = rows.slice(0, index).map((item) => item.close);
  const volumes = rows.slice(Math.max(0, index - 19), index + 1).map((item) => item.volume);
  const previous = rows[index - 1]?.close ?? row.close;
  const ma5 = average(closes.slice(-5));
  const ma20 = average(closes.slice(-20));
  const ma50 = average(closes.slice(-50));
  const volumeAverage20 = average(volumes);
  const macd = average(closes.slice(-12)) - average(closes.slice(-26));
  const previousMacd = index > 0 ? average(previousCloses.slice(-12)) - average(previousCloses.slice(-26)) : macd;
  const rsi = calculateRsi(closes);
  const volumeRatio = volumeAverage20 > 0 ? row.volume / volumeAverage20 : 0;
  const macdDirection = macd >= previousMacd ? "上昇" : "低下";
  const high20Breakout = row.close >= Math.max(...closes.slice(-20)) ? "20日高値更新" : "";
  const score = [
    row.close > ma20,
    ma20 > ma50,
    volumeRatio >= 1.2,
    rsi >= 40 && rsi <= 70,
    macdDirection === "上昇",
    Boolean(high20Breakout)
  ].filter(Boolean).length;

  return {
    ...row,
    changePercent: previous > 0 ? ((row.close - previous) / previous) * 100 : 0,
    volumeAverage20,
    volumeRatio,
    intradayRangePercent: row.close > 0 ? ((row.high - row.low) / row.close) * 100 : 0,
    rsi,
    macd,
    macdSignal: previousMacd,
    macdHistogram: macd - previousMacd,
    macdDirection,
    rsiSignal: rsi >= 70 ? "過熱" : rsi >= 55 ? "強気圏" : rsi <= 35 ? "弱気圏" : "中立",
    high20Breakout,
    ma5,
    ma20,
    ma50,
    volumeAverage: volumeAverage20,
    closeAfter5Days: null,
    changeAfter5Days: null,
    closeAfter10Days: null,
    changeAfter10Days: null,
    score,
    pattern: score >= 5 ? "上昇候補" : score <= 2 ? "リスク監視" : "",
    comment: "",
    source
  };
}

function calculateRsi(closes: number[]) {
  const target = closes.slice(-15);
  if (target.length < 2) return 50;
  let gains = 0;
  let losses = 0;
  for (let index = 1; index < target.length; index += 1) {
    const diff = target[index] - target[index - 1];
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }
  if (losses === 0) return 70;
  const rs = gains / losses;
  return 100 - (100 / (1 + rs));
}

function average(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
