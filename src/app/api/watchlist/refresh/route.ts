import { NextRequest, NextResponse } from "next/server";
import { fetchWatchlistLookup, type SearchMarket } from "@/lib/watchlist-lookup";

export const dynamic = "force-dynamic";

type RefreshRequestItem = {
  ticker?: string;
  market?: SearchMarket;
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as { items?: RefreshRequestItem[] };
    const items = Array.isArray(body.items) ? body.items : [];
    if (items.length === 0) {
      return NextResponse.json({ ok: false, error: "更新対象の銘柄がありません。" }, { status: 400 });
    }

    const uniqueItems = dedupeItems(items);
    const settled = await Promise.allSettled(
      uniqueItems.map(async (item) => {
        const ticker = String(item.ticker ?? "").trim().toUpperCase();
        const market: SearchMarket = item.market === "jp" ? "jp" : "us";
        const result = await fetchWatchlistLookup(ticker, market);
        return { ticker: result.stock.ticker, ...result };
      })
    );

    const results = settled.map((entry, index) => {
      const ticker = uniqueItems[index]?.ticker ?? "unknown";
      if (entry.status === "fulfilled") return entry.value;
      return {
        ticker,
        ok: false as const,
        error: entry.reason instanceof Error ? entry.reason.message : "更新に失敗しました。"
      };
    });

    const successCount = results.filter((row) => row.ok !== false).length;
    const failureCount = results.length - successCount;

    return NextResponse.json({
      ok: true,
      successCount,
      failureCount,
      results
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Watchlist一括更新に失敗しました。"
    }, { status: 500 });
  }
}

function dedupeItems(items: RefreshRequestItem[]) {
  const map = new Map<string, RefreshRequestItem>();
  items.forEach((item) => {
    const ticker = String(item.ticker ?? "").trim().toUpperCase();
    if (!ticker) return;
    map.set(ticker, { ticker, market: item.market === "jp" ? "jp" : "us" });
  });
  return [...map.values()];
}
