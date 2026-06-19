/**
 * Twelve Data API クライアント
 * 無料枠: 800 credits/日, 8 req/分
 * 登録: https://twelvedata.com/
 * 環境変数: TWELVE_DATA_KEY
 *
 * 日本株: "7203:TSE" 形式 (東証)
 * 米国株: "AAPL", "RGTI" 形式
 */

import type { DailyPrice } from "@/types";
import type { StockDataResult } from "@/lib/stock-data";

// ─── API response types ───────────────────────────────────────────────────────

type TwelveDataBar = {
  datetime: string; // "2024-06-19"
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
};

type TwelveDataTimeSeries = {
  meta?: {
    symbol: string;
    interval: string;
    currency: string;
    exchange: string;
    type: string;
  };
  values?: TwelveDataBar[];
  status?: string;
  message?: string;
  code?: number;
};

type TwelveDataQuote = {
  symbol?: string;
  name?: string;
  exchange?: string;
  currency?: string;
  datetime?: string;
  open?: string;
  high?: string;
  low?: string;
  close?: string;
  volume?: string;
  previous_close?: string;
  change?: string;
  percent_change?: string;
  is_market_open?: boolean;
  fifty_two_week?: { low: string; high: string };
  status?: string;
  message?: string;
  code?: number;
};

// ─── Public API ───────────────────────────────────────────────────────────────

export function hasTwelveDataKey() {
  return Boolean(process.env.TWELVE_DATA_KEY);
}

/**
 * 日足OHLCVを取得して DailyPrice[] に変換する。
 * 最大5000本（約20年分）まで取得可能。
 */
export async function fetchTwelveDataHistory(ticker: string): Promise<StockDataResult> {
  const key = process.env.TWELVE_DATA_KEY;
  if (!key) throw new Error("TWELVE_DATA_KEY is not set.");

  const symbol = normalizeTwelveDataSymbol(ticker);
  const url = buildUrl("time_series", {
    symbol,
    interval: "1day",
    outputsize: "5000",
    order: "ASC",
    apikey: key,
  });

  const response = await fetch(url, { next: { revalidate: 0 } });
  if (!response.ok) {
    throw new Error(`Twelve Data API error: ${response.status}`);
  }

  const payload = await response.json() as TwelveDataTimeSeries;

  // エラーレスポンス
  if (payload.status === "error" || payload.code) {
    throw new Error(
      `Twelve Data: ${payload.message ?? "Unknown error"} (code: ${payload.code ?? "?"})`
    );
  }

  const bars = payload.values ?? [];
  if (bars.length === 0) {
    throw new Error(`${ticker}: Twelve Dataから日足データを取得できませんでした。ティッカーを確認してください。`);
  }

  const rawRows = bars
    .map((bar) => ({
      date: bar.datetime.slice(0, 10), // "2024-06-19"
      open: parseFloat(bar.open),
      high: parseFloat(bar.high),
      low: parseFloat(bar.low),
      close: parseFloat(bar.close),
      volume: parseFloat(bar.volume),
    }))
    .filter(isValidRow);

  if (rawRows.length === 0) {
    throw new Error(`${ticker}: Twelve Dataの日足に有効な価格データがありません。`);
  }

  const prices: DailyPrice[] = rawRows.map((row, index) =>
    buildDailyPrice(rawRows, row, index, `Twelve Data`)
  );

  return {
    prices,
    mode: "live",
    provider: "twelve_data",
    warning:
      symbol !== ticker
        ? `${ticker} は ${symbol} として Twelve Data から取得しました。`
        : undefined,
  };
}

/**
 * リアルタイムクオートを取得する（1 credit消費）。
 * 市場クローズ中は直近終値を返す。
 */
export async function fetchTwelveDataQuote(ticker: string): Promise<TwelveDataQuoteResult> {
  const key = process.env.TWELVE_DATA_KEY;
  if (!key) throw new Error("TWELVE_DATA_KEY is not set.");

  const symbol = normalizeTwelveDataSymbol(ticker);
  const url = buildUrl("quote", { symbol, apikey: key });

  const response = await fetch(url, { next: { revalidate: 0 } });
  if (!response.ok) throw new Error(`Twelve Data quote error: ${response.status}`);

  const data = await response.json() as TwelveDataQuote;
  if (data.status === "error" || data.code) {
    throw new Error(`Twelve Data: ${data.message ?? "Unknown error"}`);
  }

  const close = parseFloat(data.close ?? "0");
  const prevClose = parseFloat(data.previous_close ?? String(close));
  const change = close - prevClose;
  const changePct = prevClose > 0 ? (change / prevClose) * 100 : 0;

  return {
    ticker: data.symbol ?? ticker,
    exchange: data.exchange ?? "",
    currency: data.currency ?? "USD",
    price: close,
    previousClose: prevClose,
    change,
    changePercent: changePct,
    volume: parseFloat(data.volume ?? "0"),
    high: parseFloat(data.high ?? String(close)),
    low: parseFloat(data.low ?? String(close)),
    isMarketOpen: data.is_market_open ?? false,
    asOf: data.datetime ?? new Date().toISOString(),
  };
}

export type TwelveDataQuoteResult = {
  ticker: string;
  exchange: string;
  currency: string;
  price: number;
  previousClose: number;
  change: number;
  changePercent: number;
  volume: number;
  high: number;
  low: number;
  isMarketOpen: boolean;
  asOf: string;
};

// ─── Symbol normalization ─────────────────────────────────────────────────────

/**
 * Twelve Data のシンボル形式に正規化する。
 * - 日本株（4桁）: "7203" → "7203:TSE"
 * - .T / .JP サフィックス → "7203:TSE"
 * - 米国株: そのまま
 */
export function normalizeTwelveDataSymbol(ticker: string): string {
  const t = ticker.trim().toUpperCase();
  if (/^\d{4}$/.test(t)) return `${t}:TSE`;
  if (/^\d{4}\.T$/i.test(t)) return `${t.slice(0, 4)}:TSE`;
  if (/^\d{4}\.JP$/i.test(t)) return `${t.slice(0, 4)}:TSE`;
  return t;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildUrl(endpoint: string, params: Record<string, string>) {
  const base = `https://api.twelvedata.com/${endpoint}`;
  const query = new URLSearchParams(params).toString();
  return `${base}?${query}`;
}

type RawRow = { date: string; open: number; high: number; low: number; close: number; volume: number };

function isValidRow(row: RawRow): boolean {
  return (
    Boolean(row.date) &&
    Number.isFinite(row.open) &&
    Number.isFinite(row.high) &&
    Number.isFinite(row.low) &&
    Number.isFinite(row.close) &&
    row.close > 0 &&
    Number.isFinite(row.volume)
  );
}

function buildDailyPrice(rows: RawRow[], row: RawRow, index: number, source: string): DailyPrice {
  const closes = rows.slice(0, index + 1).map((r) => r.close);
  const prevCloses = rows.slice(0, index).map((r) => r.close);
  const volumes = rows.slice(Math.max(0, index - 19), index + 1).map((r) => r.volume);
  const previous = rows[index - 1]?.close ?? row.close;

  const ma5 = avg(closes.slice(-5));
  const ma20 = avg(closes.slice(-20));
  const ma50 = avg(closes.slice(-50));
  const volumeAvg20 = avg(volumes);
  const macd = avg(closes.slice(-12)) - avg(closes.slice(-26));
  const prevMacd = index > 0 ? avg(prevCloses.slice(-12)) - avg(prevCloses.slice(-26)) : macd;
  const rsi = calcRsi(closes);
  const volumeRatio = volumeAvg20 > 0 ? row.volume / volumeAvg20 : 0;
  const macdDirection = macd >= prevMacd ? "上昇" : "低下";
  const high20Breakout = row.close >= Math.max(...closes.slice(-20)) ? "20日高値更新" : "";
  const score = [
    row.close > ma20,
    ma20 > ma50,
    volumeRatio >= 1.2,
    rsi >= 40 && rsi <= 70,
    macdDirection === "上昇",
    Boolean(high20Breakout),
  ].filter(Boolean).length;

  return {
    ...row,
    changePercent: previous > 0 ? ((row.close - previous) / previous) * 100 : 0,
    volumeAverage20: volumeAvg20,
    volumeRatio,
    intradayRangePercent: row.close > 0 ? ((row.high - row.low) / row.close) * 100 : 0,
    rsi,
    macd,
    macdSignal: prevMacd,
    macdHistogram: macd - prevMacd,
    macdDirection,
    rsiSignal:
      rsi >= 70 ? "過熱" : rsi >= 55 ? "強気圏" : rsi <= 35 ? "弱気圏" : "中立",
    high20Breakout,
    ma5,
    ma20,
    ma50,
    volumeAverage: volumeAvg20,
    closeAfter5Days: null,
    changeAfter5Days: null,
    closeAfter10Days: null,
    changeAfter10Days: null,
    score,
    pattern: score >= 5 ? "上昇候補" : score <= 2 ? "リスク監視" : "",
    comment: "",
    source,
  };
}

function calcRsi(closes: number[]): number {
  const target = closes.slice(-15);
  if (target.length < 2) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i < target.length; i++) {
    const diff = target[i] - target[i - 1];
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }
  if (losses === 0) return 70;
  return 100 - 100 / (1 + gains / losses);
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}
