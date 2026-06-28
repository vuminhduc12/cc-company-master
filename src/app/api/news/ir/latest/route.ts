import { NextRequest, NextResponse } from "next/server";
import { loadRecentSavedNewsForTickers } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const tickers = (request.nextUrl.searchParams.get("tickers") ?? "")
    .split(",")
    .map((ticker) => ticker.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 100);
  if (!tickers.length) {
    return NextResponse.json({ ok: true, news: [] });
  }

  const news = await loadRecentSavedNewsForTickers(tickers, 60);
  return NextResponse.json({ ok: true, news });
}
