import { NextRequest, NextResponse } from "next/server";
import { scanIrNewsForWatchlist } from "@/lib/ir-news";
import { loadServerWatchlistItems } from "@/lib/server-watchlist";
import { saveNewsItems } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  return runIrNewsScan(request);
}

export async function POST(request: NextRequest) {
  return runIrNewsScan(request);
}

async function runIrNewsScan(request: NextRequest) {
  const authError = authorize(request);
  if (authError) return authError;

  try {
    const watchlist = await loadServerWatchlistItems();
    const result = await scanIrNewsForWatchlist(watchlist.items);
    const saveResult = await saveNewsItems(result.news);
    return NextResponse.json({
      ok: true,
      scanned: result.scanned,
      found: result.news.length,
      saved: saveResult.saved,
      savedCount: saveResult.count ?? 0,
      failed: result.failed,
      errors: result.errors.length ? result.errors : undefined,
      runAt: new Date().toISOString()
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error"
    }, { status: 500 });
  }
}

function authorize(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV !== "production") return null;
    return NextResponse.json({ ok: false, error: "CRON_SECRET is not configured." }, { status: 401 });
  }
  const bearer = request.headers.get("authorization")?.replace("Bearer ", "");
  const manual = request.headers.get("x-cron-secret");
  if (bearer === secret || manual === secret) return null;
  return NextResponse.json({ ok: false, error: "Invalid CRON_SECRET." }, { status: 401 });
}
