import { NextRequest, NextResponse } from "next/server";
import { getPricesForTicker, news as mockNews, watchlist } from "@/lib/mock-data";
import { analyzeStock } from "@/lib/scoring";
import type { DailyPrice, NewsItem, Stock, WatchStatus } from "@/types";

type TradeSide = "auto" | "margin_buy" | "short_sell";

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
    const body = await request.json().catch(() => ({})) as { ticker?: string; side?: TradeSide };
    const ticker = String(body.ticker ?? "").trim().toUpperCase();
    const side = body.side ?? "auto";
    if (!ticker || !/^[A-Z0-9.-]{1,12}$/.test(ticker)) {
      return NextResponse.json({ ok: false, error: "ティッカーを正しく入力してください。" }, { status: 400 });
    }

    const stock = resolveStock(ticker);
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

function resolveStock(ticker: string): Stock {
  const found = watchlist.find((item) => item.stock.ticker === ticker)?.stock;
  return found ?? {
    ticker,
    companyName: ticker,
    sector: "Unknown",
    exchange: ticker.includes(".") ? "Local" : "NASDAQ/NYSE"
  };
}

async function fetchStockData(ticker: string): Promise<{ prices: DailyPrice[]; mode: "live" | "mock"; warning?: string }> {
  const fallback = getPricesForTicker(ticker);
  const key = process.env.STOCK_API_KEY;
  if (!key) {
    if (fallback) return { prices: fallback, mode: "mock", warning: "STOCK_API_KEY未設定のため、ローカルデータを表示しています。" };
    if (isJapaneseTicker(ticker)) {
      return fetchYahooFinanceStockData(ticker, "STOCK_API_KEY未設定のため、日本株はYahoo Financeから取得しました。");
    }
    throw new Error("STOCK_API_KEYが未設定です。この銘柄はローカルデータがないため取得できません。");
  }

  const apiSymbol = normalizeAlphaVantageSymbol(ticker);
  const url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(apiSymbol)}&apikey=${key}&outputsize=compact`;
  const response = await fetch(url, { next: { revalidate: 0 } });
  if (!response.ok) throw new Error(`Stock API error: ${response.status}`);
  const payload = await response.json() as {
    ["Time Series (Daily)"]?: Record<string, Record<string, string>>;
    Note?: string;
    Information?: string;
    Error?: string;
    ["Error Message"]?: string;
  };
  const series = payload["Time Series (Daily)"];
  if (!series) {
    const message = normalizeStockApiMessage(payload.Note ?? payload.Information ?? payload.Error ?? payload["Error Message"], ticker, apiSymbol);
    if (isJapaneseTicker(ticker)) {
      try {
        return await fetchYahooFinanceStockData(ticker, `${message} 代替データソースとしてYahoo Financeから取得しました。`);
      } catch {
        throw new Error(`${message} Yahoo Financeでも取得できませんでした。`);
      }
    }
    if (fallback) {
      return { prices: fallback, mode: "mock", warning: `${message} ローカルデータを表示しています。` };
    }
    throw new Error(message);
  }

  const rows = Object.entries(series).reverse().map(([date, row]) => ({
    date,
    open: Number(row["1. open"]),
    high: Number(row["2. high"]),
    low: Number(row["3. low"]),
    close: Number(row["4. close"]),
    volume: Number(row["5. volume"])
  }));

  return {
    prices: rows.map((row, index) => buildDailyPrice(rows, row, index, "Alpha Vantage")),
    mode: "live",
    warning: apiSymbol !== ticker ? `${ticker} は日本株コードとして ${apiSymbol} に変換して取得しました。` : undefined
  };
}

function normalizeAlphaVantageSymbol(ticker: string) {
  if (/^\d{4}$/.test(ticker)) return `${ticker}.T`;
  return ticker;
}

function isJapaneseTicker(ticker: string) {
  return /^\d{4}$/.test(ticker) || /^\d{4}\.T$/i.test(ticker) || /^\d{4}\.JP$/i.test(ticker);
}

function normalizeYahooSymbol(ticker: string) {
  if (/^\d{4}$/.test(ticker)) return `${ticker}.T`;
  if (/^\d{4}\.JP$/i.test(ticker)) return ticker.replace(/\.JP$/i, ".T");
  return ticker;
}

async function fetchYahooFinanceStockData(ticker: string, warning: string): Promise<{ prices: DailyPrice[]; mode: "live"; warning?: string }> {
  const symbol = normalizeYahooSymbol(ticker);
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=6mo&interval=1d`;
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
  })).filter((row) => row.date && Number.isFinite(row.close) && row.close > 0);
  if (rows.length === 0) throw new Error(`${ticker}: Yahoo Financeのレスポンスに有効な日足データがありません。`);
  const compactRows = rows.slice(-120);
  return {
    prices: compactRows.map((row, index) => buildDailyPrice(compactRows, row, index, "Yahoo Finance")),
    mode: "live",
    warning: `${warning} 取得シンボル: ${symbol}`
  };
}

function buildDailyPrice(rows: Array<{ date: string; open: number; high: number; low: number; close: number; volume: number }>, row: { date: string; open: number; high: number; low: number; close: number; volume: number }, index: number, source: string): DailyPrice {
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

function clamp(value: number, min: number, max: number) {
  if (Number.isNaN(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function normalizeStockApiMessage(message: string | undefined, ticker: string, apiSymbol: string) {
  if (!message) {
    return `${ticker}: 株価APIから日足データを取得できませんでした。実際に試したシンボルは ${apiSymbol} です。ティッカー、APIキー、無料枠の上限を確認してください。`;
  }
  const lower = message.toLowerCase();
  if (lower.includes("invalid api call") || lower.includes("error message")) {
    return `${ticker}: Alpha Vantageで ${apiSymbol} が認識されませんでした。米国株は例: RGTI / SIDU、日本株は例: 7203.T のような形式を試しますが、Alpha Vantage側が未対応の銘柄もあります。詳細: ${message}`;
  }
  if (lower.includes("rate limit") || lower.includes("free api requests") || lower.includes("standard api rate limit") || lower.includes("premium")) {
    return `${ticker}: Alpha Vantage無料枠の制限に達しています。1分以上空けるか、1日上限リセット後に再実行してください。詳細: ${message}`;
  }
  if (lower.includes("api key") || lower.includes("apikey")) {
    return `${ticker}: STOCK_API_KEYが無効、または未反映の可能性があります。Vercel/ローカルの環境変数と再起動を確認してください。詳細: ${message}`;
  }
  return `${ticker}: ${message}`;
}
