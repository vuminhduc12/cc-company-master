import { NextRequest, NextResponse } from "next/server";
import { checkServerAlertsForTicker, loadServerAlertTickers } from "@/lib/server-price-alerts";
import { createServerSupabase } from "@/lib/supabase";
import { fetchWatchlistLookup } from "@/lib/watchlist-lookup";
import { watchlist } from "@/lib/mock-data";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Lightweight price-only refresh cron.
 * Vercel Hobby can only invoke cron once per day, so frequent refreshes should
 * be kicked by an external scheduler such as GitHub Actions.
 * No AI analysis — just fetches latest price, upserts daily_prices, and checks alerts.
 */
export async function GET(request: NextRequest) {
  const authError = authorize(request);
  if (authError) return authError;

  const supabase = createServerSupabase();
  const tickers = await resolveTargetTickers(supabase);
  if (tickers.length === 0) {
    return NextResponse.json({ ok: true, message: "対象銘柄なし。", refreshed: 0, failed: 0 });
  }

  let refreshed = 0;
  let failed = 0;
  let triggeredAlerts = 0;
  const errors: string[] = [];

  for (const { ticker, market } of tickers) {
    try {
      const result = await fetchWatchlistLookup(ticker, market);
      if (!result.ok || !result.price) {
        failed++;
        continue;
      }

      if (supabase) {
        const { data: stock } = await supabase
          .from("stocks")
          .upsert(
            {
              ticker: result.stock.ticker,
              company_name: result.stock.companyName,
              sector: result.stock.sector,
              exchange: result.stock.exchange,
            },
            { onConflict: "ticker" }
          )
          .select("id")
          .single();

        if (stock?.id) {
          const p = result.price;
          await supabase.from("daily_prices").upsert(
            {
              stock_id: stock.id,
              date: p.date,
              open: p.open,
              high: p.high,
              low: p.low,
              close: p.close,
              volume: p.volume,
              change_percent: p.changePercent,
              volume_average20: p.volumeAverage20,
              volume_ratio: p.volumeRatio,
              intraday_range_percent: p.intradayRangePercent,
              rsi: p.rsi,
              macd: p.macd,
              macd_signal: p.macdSignal,
              macd_histogram: p.macdHistogram,
              macd_direction: p.macdDirection,
              ma5: p.ma5,
              ma20: p.ma20,
              ma50: p.ma50,
              score: p.score,
              pattern: p.pattern,
              source: p.source ?? "price-refresh-cron",
            },
            { onConflict: "stock_id,date" }
          );
        }
      }

      const alertResult = await checkServerAlertsForTicker(result.stock.ticker, {
        price: result.price.close,
        rsi: result.price.rsi,
        volumeRatio: result.price.volumeRatio,
      });
      triggeredAlerts += alertResult.triggered;
      if (alertResult.error) errors.push(`${ticker} alerts: ${alertResult.error}`);

      refreshed++;
    } catch (error) {
      failed++;
      errors.push(`${ticker}: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  return NextResponse.json({
    ok: true,
    refreshed,
    failed,
    triggeredAlerts,
    total: tickers.length,
    runAt: new Date().toISOString(),
    errors: errors.length > 0 ? errors : undefined,
  });
}

type TickerTarget = { ticker: string; market: "us" | "jp" };

async function resolveTargetTickers(
  supabase: ReturnType<typeof createServerSupabase>
): Promise<TickerTarget[]> {
  if (supabase) {
    const { data } = await supabase.from("stocks").select("ticker").order("ticker");
    const alertTickers = await loadServerAlertTickers();
    const tickerSet = new Set<string>([
      ...((data ?? []) as { ticker: string }[]).map((row) => row.ticker),
      ...alertTickers,
    ]);
    if (tickerSet.size > 0) {
      return Array.from(tickerSet).map((ticker) => ({
        ticker,
        market: ticker.endsWith(".T") ? "jp" : "us",
      }));
    }
  }
  return watchlist.map((item) => ({ ticker: item.stock.ticker, market: "us" as const }));
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
