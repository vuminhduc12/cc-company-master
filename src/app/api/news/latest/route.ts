import { NextResponse } from "next/server";
import { fetchNewsFromNewsApi } from "@/lib/news-api";
import type { Stock } from "@/types";

export const dynamic = "force-dynamic";

type RequestBody = {
  stock?: Stock;
  ticker?: string;
};

export async function POST(request: Request) {
  try {
    const body = await request.json() as RequestBody;
    const ticker = (body.stock?.ticker ?? body.ticker ?? "").toUpperCase();
    if (!ticker) {
      return NextResponse.json({ ok: false, error: "ticker is required" }, { status: 400 });
    }

    const stock = body.stock ?? { ticker, companyName: ticker, exchange: "", sector: "" };
    const result = await fetchNewsFromNewsApi(stock);

    return NextResponse.json({
      ok: true,
      mode: result.mode,
      source: result.source,
      fetchedAt: result.fetchedAt,
      news: result.news,
      warning: result.warning
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 500 }
    );
  }
}
