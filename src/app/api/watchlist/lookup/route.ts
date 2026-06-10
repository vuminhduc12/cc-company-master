import { NextRequest, NextResponse } from "next/server";
import { fetchWatchlistLookup, type SearchMarket } from "@/lib/watchlist-lookup";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as { ticker?: string; market?: SearchMarket };
    const market = body.market === "jp" ? "jp" : "us";
    const ticker = String(body.ticker ?? "").trim().toUpperCase();
    const result = await fetchWatchlistLookup(ticker, market);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "銘柄検索に失敗しました。"
    }, { status: 500 });
  }
}
