import { NextResponse } from "next/server";

export async function GET() {
  try {
    const response = await fetch("https://query2.finance.yahoo.com/v8/finance/chart/JPY=X?range=1d&interval=1m", {
      headers: { "user-agent": "Mozilla/5.0" },
      next: { revalidate: 60 }
    });
    if (!response.ok) {
      return NextResponse.json({ ok: false, error: `Yahoo Finance returned ${response.status}` }, { status: 502 });
    }

    const payload = await response.json() as {
      chart?: {
        result?: Array<{
          meta?: { regularMarketPrice?: number };
          timestamp?: number[];
          indicators?: { quote?: Array<{ close?: Array<number | null> }> };
        }>;
        error?: { description?: string };
      };
    };
    const result = payload.chart?.result?.[0];
    const closes = result?.indicators?.quote?.[0]?.close?.filter((value): value is number => Number.isFinite(value)) ?? [];
    const rate = result?.meta?.regularMarketPrice ?? closes.at(-1);
    const timestamp = result?.timestamp?.at(-1);

    if (!Number.isFinite(rate) || !rate) {
      return NextResponse.json({ ok: false, error: payload.chart?.error?.description ?? "USD/JPY rate not found" }, { status: 502 });
    }

    return NextResponse.json({
      ok: true,
      pair: "USDJPY",
      rate,
      source: "Yahoo Finance",
      asOf: timestamp ? new Date(timestamp * 1000).toISOString() : new Date().toISOString()
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 500 }
    );
  }
}
