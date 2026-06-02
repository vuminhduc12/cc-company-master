import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type YahooChartResult = {
  meta?: {
    currency?: string;
    symbol?: string;
    exchangeName?: string;
    fullExchangeName?: string;
    instrumentType?: string;
    regularMarketPrice?: number;
    chartPreviousClose?: number;
    previousClose?: number;
    regularMarketTime?: number;
    regularMarketDayLow?: number;
    regularMarketDayHigh?: number;
    fiftyTwoWeekLow?: number;
    fiftyTwoWeekHigh?: number;
    marketCap?: number;
    averageDailyVolume3Month?: number;
    marketState?: string;
    postMarketPrice?: number;
    postMarketChange?: number;
    postMarketChangePercent?: number;
    postMarketTime?: number;
    preMarketPrice?: number;
    preMarketChange?: number;
    preMarketChangePercent?: number;
    preMarketTime?: number;
  };
  timestamp?: number[];
  indicators?: {
    quote?: Array<{
      close?: Array<number | null>;
    }>;
  };
};

type YahooChartPayload = {
  chart?: {
    result?: YahooChartResult[];
    error?: { description?: string };
  };
};

export async function GET(request: NextRequest) {
  const ticker = request.nextUrl.searchParams.get("ticker")?.trim().toUpperCase();
  if (!ticker) {
    return NextResponse.json({ ok: false, error: "ticker is required" }, { status: 400 });
  }

  try {
    const symbol = normalizeYahooSymbol(ticker);
    const response = await fetch(`https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1m&includePrePost=true`, {
      headers: { "user-agent": "Mozilla/5.0" },
      next: { revalidate: 0 }
    });

    if (!response.ok) {
      return NextResponse.json({ ok: false, error: `Yahoo Finance returned ${response.status}` }, { status: 502 });
    }

    const payload = await response.json() as YahooChartPayload;
    const result = payload.chart?.result?.[0];
    const meta = result?.meta;
    const closes = result?.indicators?.quote?.[0]?.close ?? [];
    const lastClose = closes.filter(isFiniteNumber).at(-1);
    const regularPrice = finiteOrNull(meta?.regularMarketPrice) ?? lastClose;
    const previousClose = finiteOrNull(meta?.previousClose) ?? finiteOrNull(meta?.chartPreviousClose);

    if (!result || !meta || !isFiniteNumber(regularPrice)) {
      return NextResponse.json({ ok: false, error: payload.chart?.error?.description ?? "Realtime quote not found" }, { status: 502 });
    }

    const regularAsOf = toIso(meta.regularMarketTime ?? result.timestamp?.at(-1));
    const regularChange = previousClose && previousClose > 0 ? regularPrice - previousClose : null;
    const regularChangePercent = previousClose && previousClose > 0 ? (regularChange! / previousClose) * 100 : null;
    const extended = buildExtendedSession(meta, result, regularPrice);

    return NextResponse.json({
      ok: true,
      ticker,
      yahooSymbol: symbol,
      source: "Yahoo Finance realtime chart",
      marketState: meta.marketState ?? "UNKNOWN",
      regular: {
        price: regularPrice,
        previousClose,
        change: regularChange,
        changePercent: regularChangePercent,
        currency: meta.currency ?? "USD",
        asOf: regularAsOf
      },
      extended,
      summary: {
        exchange: meta.fullExchangeName ?? meta.exchangeName ?? null,
        dayRange: {
          low: finiteOrNull(meta.regularMarketDayLow),
          high: finiteOrNull(meta.regularMarketDayHigh)
        },
        yearRange: {
          low: finiteOrNull(meta.fiftyTwoWeekLow),
          high: finiteOrNull(meta.fiftyTwoWeekHigh)
        },
        marketCap: finiteOrNull(meta.marketCap),
        averageVolume: finiteOrNull(meta.averageDailyVolume3Month),
        instrumentType: meta.instrumentType ?? null
      },
      intraday: buildIntradayPoints(result, meta.regularMarketTime),
      fetchedAt: new Date().toISOString()
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Unknown realtime quote error"
    }, { status: 500 });
  }
}

function buildExtendedSession(meta: NonNullable<YahooChartResult["meta"]>, result: YahooChartResult, regularPrice: number) {
  const postPrice = finiteOrNull(meta.postMarketPrice);
  if (postPrice) {
    return {
      session: "post",
      label: "時間外取引",
      price: postPrice,
      change: finiteOrNull(meta.postMarketChange),
      changePercent: finiteOrNull(meta.postMarketChangePercent),
      asOf: toIso(meta.postMarketTime)
    };
  }

  const prePrice = finiteOrNull(meta.preMarketPrice);
  if (prePrice) {
    return {
      session: "pre",
      label: "プレマーケット",
      price: prePrice,
      change: finiteOrNull(meta.preMarketChange),
      changePercent: finiteOrNull(meta.preMarketChangePercent),
      asOf: toIso(meta.preMarketTime)
    };
  }

  const lastExtendedPoint = buildIntradayPoints(result, meta.regularMarketTime)
    .filter((point) => point.session === "extended")
    .at(-1);
  if (lastExtendedPoint) {
    const change = lastExtendedPoint.price - regularPrice;
    return {
      session: "post",
      label: "時間外取引",
      price: lastExtendedPoint.price,
      change,
      changePercent: regularPrice > 0 ? (change / regularPrice) * 100 : null,
      asOf: lastExtendedPoint.time
    };
  }

  return null;
}

function buildIntradayPoints(result: YahooChartResult, regularMarketTime: number | undefined) {
  const timestamps = result.timestamp ?? [];
  const closes = result.indicators?.quote?.[0]?.close ?? [];
  return timestamps.map((timestamp, index) => {
    const price = closes[index];
    if (!isFiniteNumber(price)) return null;
    return {
      time: toIso(timestamp),
      price,
      session: regularMarketTime && timestamp > regularMarketTime ? "extended" : "regular"
    };
  }).filter((item): item is { time: string; price: number; session: "regular" | "extended" } => Boolean(item));
}

function normalizeYahooSymbol(ticker: string) {
  if (/^\d{4}$/.test(ticker)) return `${ticker}.T`;
  if (/^\d{4}\.JP$/i.test(ticker)) return ticker.replace(/\.JP$/i, ".T");
  return ticker;
}

function finiteOrNull(value: unknown) {
  return isFiniteNumber(value) ? value : null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function toIso(timestamp: number | undefined) {
  return timestamp ? new Date(timestamp * 1000).toISOString() : new Date().toISOString();
}
