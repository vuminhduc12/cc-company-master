import { NextRequest, NextResponse } from "next/server";
import { news as mockNews, watchlist } from "@/lib/mock-data";
import { analyzeStock } from "@/lib/scoring";
import { fetchStockData } from "@/lib/stock-data";
import type { Stock } from "@/types";

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ ticker: string }> }) {
  try {
    const { ticker } = await params;
    const normalizedTicker = normalizeTicker(ticker);
    if (!normalizedTicker || !/^[A-Z0-9.-]{1,12}$/.test(normalizedTicker)) {
      return NextResponse.json({ ok: false, error: "ティッカーが正しくありません。" }, { status: 400 });
    }

    const stock = resolveStock(normalizedTicker);
    const stockData = await fetchStockData(normalizedTicker);
    const latest = stockData.prices.at(-1);
    if (!latest) throw new Error(`${normalizedTicker}: 日足データがありません。`);

    const relatedNews = mockNews.filter((item) => item.ticker === normalizedTicker);
    const analysis = analyzeStock(latest, relatedNews);
    return NextResponse.json({
      ok: true,
      stock,
      prices: stockData.prices,
      price: latest,
      news: relatedNews,
      score: analysis.score,
      status: analysis.status,
      mode: stockData.mode,
      provider: stockData.provider,
      sourceLabel: stockData.provider === "saved"
        ? "Supabase saved history"
        : stockData.provider === "local"
          ? "Local verified history"
          : latest.source,
      warning: stockData.warning,
      fetchedAt: new Date().toISOString()
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "株価履歴の取得に失敗しました。"
    }, { status: 500 });
  }
}

function normalizeTicker(ticker: string) {
  const normalized = ticker.trim().toUpperCase();
  if (/^\d{4}$/.test(normalized)) return `${normalized}.T`;
  if (/^\d{4}\.JP$/i.test(normalized)) return normalized.replace(/\.JP$/i, ".T");
  return normalized;
}

function resolveStock(ticker: string): Stock {
  const found = watchlist.find((item) => item.stock.ticker === ticker)?.stock;
  if (found) return found;
  return {
    ticker,
    companyName: ticker,
    sector: /^\d{4}\.T$/i.test(ticker) ? "Japan Equity" : "US Equity",
    exchange: /^\d{4}\.T$/i.test(ticker) ? "TSE" : "NASDAQ/NYSE"
  };
}
