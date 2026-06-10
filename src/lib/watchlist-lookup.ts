import { news as mockNews, watchlist } from "@/lib/mock-data";
import { analyzeStock } from "@/lib/scoring";
import { fetchStockData } from "@/lib/stock-data";
import type { DailyPrice, Stock, WatchStatus } from "@/types";

export type SearchMarket = "us" | "jp";

export type WatchlistLookupPayload = {
  ok: true;
  mode: "live" | "mock";
  provider: "yahoo" | "alpha_vantage" | "saved" | "local";
  stock: Stock;
  prices: DailyPrice[];
  price: DailyPrice;
  previousClose: number;
  score: number;
  status: WatchStatus;
  warning?: string;
  fetchedAt: string;
};

export async function fetchWatchlistLookup(ticker: string, market: SearchMarket): Promise<WatchlistLookupPayload> {
  const normalizedTicker = normalizeTickerForMarket(ticker, market);
  if (!normalizedTicker || !/^[A-Z0-9.-]{1,12}$/.test(normalizedTicker)) {
    throw new Error("ティッカーを正しく入力してください。");
  }

  const stock = resolveStock(normalizedTicker, market);
  const stockData = await fetchStockData(normalizedTicker);
  const price = stockData.prices.at(-1);
  if (!price) throw new Error(`${normalizedTicker}の株価データがありません。`);

  const relatedNews = mockNews.filter((item) => item.ticker === normalizedTicker).slice(0, 4);
  const analysis = analyzeStock(price, relatedNews);

  return {
    ok: true,
    mode: stockData.mode,
    provider: stockData.provider,
    stock,
    prices: stockData.prices,
    price,
    previousClose: stockData.prices.at(-2)?.close ?? price.close,
    score: analysis.score,
    status: analysis.status,
    warning: stockData.warning,
    fetchedAt: new Date().toISOString()
  };
}

export function normalizeTickerForMarket(ticker: string, market: SearchMarket) {
  const normalized = ticker.trim().toUpperCase();
  if (market === "jp") {
    if (/^\d{4}$/.test(normalized)) return `${normalized}.T`;
    if (/^\d{4}\.JP$/i.test(normalized)) return normalized.replace(/\.JP$/i, ".T");
  }
  return normalized;
}

function resolveStock(ticker: string, market: SearchMarket): Stock {
  const found = watchlist.find((item) => item.stock.ticker === ticker)?.stock;
  if (found) return found;
  return {
    ticker,
    companyName: ticker,
    sector: market === "jp" ? "Japan Equity" : "US Equity",
    exchange: market === "jp" ? "TSE" : "NASDAQ/NYSE"
  };
}
