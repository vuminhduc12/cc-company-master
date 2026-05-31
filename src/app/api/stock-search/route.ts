import { NextRequest, NextResponse } from "next/server";
import { news as mockNews, watchlist } from "@/lib/mock-data";
import { analyzeStock } from "@/lib/scoring";
import { fetchStockData } from "@/lib/stock-data";
import type { DailyPrice, NewsItem, Stock, WatchStatus } from "@/types";

type TradeSide = "auto" | "margin_buy" | "short_sell";
type SearchMarket = "us" | "jp";

type EntryPlan = {
  side: "信用買い候補" | "信用売り候補" | "見送り・監視";
  confidence: number;
  takeProfitProbability: number;
  entryPrice: number;
  takeProfitPrice: number;
  stopLossPrice: number;
  riskReward: number;
  timeHorizon: string;
  summary: string;
  reasons: string[];
  cautions: string[];
};

type StockSearchResponse = {
  ok: boolean;
  mode: "live" | "mock";
  stock: Stock;
  price: DailyPrice;
  prices: DailyPrice[];
  news: NewsItem[];
  score: number;
  status: WatchStatus;
  entryPlan: EntryPlan;
  warning?: string;
  error?: string;
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as { ticker?: string; side?: TradeSide; market?: SearchMarket };
    const market = body.market === "jp" ? "jp" : "us";
    const ticker = normalizeTickerForMarket(String(body.ticker ?? "").trim().toUpperCase(), market);
    const side = body.side ?? "auto";
    if (!ticker || !/^[A-Z0-9.-]{1,12}$/.test(ticker)) {
      return NextResponse.json({ ok: false, error: "ティッカーを正しく入力してください。" }, { status: 400 });
    }

    const stock = resolveStock(ticker, market);
    const stockData = await fetchStockData(ticker);
    const prices = stockData.prices;
    const price = prices[prices.length - 1];
    if (!price) throw new Error(`${ticker}の株価データがありません。`);
    const relatedNews = mockNews.filter((item) => item.ticker === ticker).slice(0, 4);
    const analysis = analyzeStock(price, relatedNews);
    const fallbackPlan = buildEntryPlan(price, analysis.score, analysis.status, relatedNews, side);
    const entryPlan = await refineEntryPlanWithAi(stock, price, relatedNews, fallbackPlan);

    const result: StockSearchResponse = {
      ok: true,
      mode: stockData.mode,
      stock,
      price,
      prices,
      news: relatedNews,
      score: analysis.score,
      status: analysis.status,
      entryPlan,
      warning: stockData.warning
    };
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
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
  return found ?? {
    ticker,
    companyName: ticker,
    sector: "Unknown",
    exchange: market === "jp" ? "TSE" : "NASDAQ/NYSE"
  };
}

function buildEntryPlan(price: DailyPrice, score: number, status: WatchStatus, news: NewsItem[], requestedSide: TradeSide): EntryPlan {
  const trendBuy = price.close > price.ma20 && price.ma20 >= price.ma50 && price.macdDirection === "上昇";
  const trendSell = price.close < price.ma20 && price.ma20 <= price.ma50 && price.macdDirection === "低下";
  const hasNegativeNews = news.some((item) => item.sentiment === "Negative" && item.impactScore >= 6);
  const hasPositiveNews = news.some((item) => item.sentiment === "Positive" && item.impactScore >= 6);
  const buyScore = score + (trendBuy ? 8 : 0) + (hasPositiveNews ? 5 : 0) - (price.rsi > 72 ? 10 : 0);
  const sellScore = (100 - score) + (trendSell ? 10 : 0) + (hasNegativeNews ? 6 : 0) - (price.rsi < 28 ? 8 : 0);
  const selectedSide = requestedSide === "margin_buy"
    ? "信用買い候補"
    : requestedSide === "short_sell"
      ? "信用売り候補"
      : buyScore >= 66 && buyScore >= sellScore
        ? "信用買い候補"
        : sellScore >= 68
          ? "信用売り候補"
          : "見送り・監視";
  const isShort = selectedSide === "信用売り候補";
  const atrLike = Math.max(price.close * Math.min(Math.max(price.intradayRangePercent / 100, 0.04), 0.14), price.close * 0.04);
  const entryPrice = price.close;
  const takeProfitPrice = isShort ? Math.max(entryPrice - atrLike * 1.8, 0.01) : entryPrice + atrLike * 1.8;
  const stopLossPrice = isShort ? entryPrice + atrLike : Math.max(entryPrice - atrLike, 0.01);
  const reward = Math.abs(takeProfitPrice - entryPrice);
  const risk = Math.abs(entryPrice - stopLossPrice);
  const baseProbability = isShort ? 38 + (sellScore - 55) * 0.75 : 38 + (buyScore - 55) * 0.75;
  const takeProfitProbability = clamp(Math.round(baseProbability + (price.volumeRatio >= 1.2 ? 5 : -3) + (status === "Strong Buy" || status === "Sell" ? 3 : 0)), 18, 82);
  const confidence = selectedSide === "見送り・監視" ? clamp(Math.round(Math.max(buyScore, sellScore) * 0.55), 20, 55) : clamp(Math.round(Math.max(buyScore, sellScore)), 45, 88);

  return {
    side: selectedSide,
    confidence,
    takeProfitProbability: selectedSide === "見送り・監視" ? Math.min(takeProfitProbability, 45) : takeProfitProbability,
    entryPrice,
    takeProfitPrice,
    stopLossPrice,
    riskReward: risk > 0 ? reward / risk : 0,
    timeHorizon: "短期 1〜10営業日",
    summary: selectedSide === "見送り・監視"
      ? "今は明確なエントリー根拠が不足しています。MA20、出来高、ニュース材料の再確認を優先します。"
      : `${selectedSide}として監視できます。ただし売買推奨ではなく、価格・出来高・ニュースを確認するための補助判定です。`,
    reasons: [
      `AIスコア ${score}点 / 判定 ${status}`,
      `終値 ${price.close.toFixed(2)}、MA20 ${price.ma20.toFixed(2)}、MA50 ${price.ma50.toFixed(2)}`,
      `RSI ${price.rsi.toFixed(1)}、出来高倍率 ${price.volumeRatio.toFixed(2)}x、MACD ${price.macdDirection}`
    ],
    cautions: [
      price.rsi > 72 ? "RSIが高く、短期の利確売りに注意。" : "RSIは過熱だけでなく反転失速も確認が必要。",
      price.volumeRatio < 1 ? "出来高が平均未満のため、エントリー根拠は弱くなります。" : "出来高が増えているため、反転時の値幅も大きくなりやすいです。",
      "信用取引は損失が保証金を上回る可能性があります。証券会社画面で最終確認してください。"
    ]
  };
}

async function refineEntryPlanWithAi(stock: Stock, price: DailyPrice, news: NewsItem[], fallback: EntryPlan): Promise<EntryPlan> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return fallback;

  const prompt = `あなたは日本語で説明する株価分析AIです。
以下の株価データとニュース要約をもとに、信用買い候補、信用売り候補、見送り・監視のどれに近いかをJSONだけで返してください。
これは投資助言ではなく分析補助です。断定的な売買推奨は禁止です。

銘柄: ${stock.ticker} / ${stock.companyName}
株価: close=${price.close}, changePercent=${price.changePercent}, volumeRatio=${price.volumeRatio}, rsi=${price.rsi}, ma20=${price.ma20}, ma50=${price.ma50}, macdDirection=${price.macdDirection}
ニュース: ${news.map((item) => `${item.title} / ${item.sentiment} / ${item.summary}`).join("\n")}
現在のルールベース判定: ${JSON.stringify(fallback)}

返却形式:
{"side":"信用買い候補 | 信用売り候補 | 見送り・監視","confidence":50,"takeProfitProbability":50,"summary":"","reasons":[],"cautions":[]}`;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" }
    })
  });
  if (!response.ok) return fallback;
  const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) return fallback;
  try {
    const parsed = JSON.parse(content) as Partial<EntryPlan>;
    const side = parsed.side === "信用買い候補" || parsed.side === "信用売り候補" || parsed.side === "見送り・監視" ? parsed.side : fallback.side;
    return {
      ...fallback,
      side,
      confidence: clamp(Math.round(Number(parsed.confidence ?? fallback.confidence)), 0, 100),
      takeProfitProbability: clamp(Math.round(Number(parsed.takeProfitProbability ?? fallback.takeProfitProbability)), 0, 100),
      summary: String(parsed.summary ?? fallback.summary),
      reasons: Array.isArray(parsed.reasons) ? parsed.reasons.map(String).slice(0, 5) : fallback.reasons,
      cautions: Array.isArray(parsed.cautions) ? parsed.cautions.map(String).slice(0, 5) : fallback.cautions
    };
  } catch {
    return fallback;
  }
}

function clamp(value: number, min: number, max: number) {
  if (Number.isNaN(value)) return min;
  return Math.max(min, Math.min(max, value));
}
