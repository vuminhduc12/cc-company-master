import { NextRequest, NextResponse } from "next/server";
import { news as mockNews, watchlist } from "@/lib/mock-data";
import { analyzeStock } from "@/lib/scoring";
import { fetchStockData } from "@/lib/stock-data";
import type { Stock } from "@/types";

type SearchMarket = "us" | "jp";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as { ticker?: string; market?: SearchMarket };
    const market = body.market === "jp" ? "jp" : "us";
    const ticker = normalizeTickerForMarket(String(body.ticker ?? "").trim().toUpperCase(), market);
    if (!ticker || !/^[A-Z0-9.-]{1,12}$/.test(ticker)) {
      return NextResponse.json({ ok: false, error: "ティッカーを正しく入力してください。" }, { status: 400 });
    }

    const stock = resolveStock(ticker, market);
    const stockData = await fetchStockData(ticker);
    const price = stockData.prices.at(-1);
    if (!price) throw new Error(`${ticker}の株価データがありません。`);

    const relatedNews = mockNews.filter((item) => item.ticker === ticker).slice(0, 4);
    const analysis = analyzeStock(price, relatedNews);

    return NextResponse.json({
      ok: true,
      mode: stockData.mode,
      provider: stockData.provider,
      stock,
      price,
      previousClose: stockData.prices.at(-2)?.close ?? price.close,
      score: analysis.score,
      status: analysis.status,
      warning: stockData.warning,
      fetchedAt: new Date().toISOString()
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "銘柄検索に失敗しました。"
    }, { status: 500 });
  }
}

function normalizeTickerForMarket(ticker: string, market: SearchMarket) {
  if (market === "jp") {
    if (/^\d{4}$/.test(ticker)) return `${ticker}.T`;
    if (/^\d{4}\.JP$/i.test(ticker)) return ticker.replace(/\.JP$/i, ".T");
  }
  return ticker;
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
