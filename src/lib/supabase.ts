import { createClient } from "@supabase/supabase-js";
import type { AiJobResult } from "@/types";

export function hasSupabaseConfig() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

function normalizeSupabaseUrl(url: string) {
  return url.replace(/\/rest\/v1\/?$/, "").replace(/\/$/, "");
}

export function createBrowserSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(normalizeSupabaseUrl(url), key);
}

export function createServerSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(normalizeSupabaseUrl(url), key, {
    auth: {
      persistSession: false
    }
  });
}

export async function loadLatestJobResult() {
  const supabase = createBrowserSupabase();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("job_runs")
    .select("result")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data?.result) return null;
  return data.result as AiJobResult;
}

export async function saveJobResult(result: AiJobResult) {
  const supabase = createServerSupabase();
  if (!supabase) return { saved: false, reason: "Supabase env is not configured." };

  const stockResults = result.stocks?.length
    ? result.stocks
    : [{
        stock: { ticker: "RGTI", companyName: "Rigetti Computing", sector: "Quantum Computing", exchange: "NASDAQ" },
        price: result.price,
        prices: [result.price],
        news: result.news
      }];

  for (const item of stockResults) {
    const { data: stock, error: stockError } = await supabase
      .from("stocks")
      .upsert({
        ticker: item.stock.ticker,
        company_name: item.stock.companyName,
        sector: item.stock.sector,
        exchange: item.stock.exchange
      }, { onConflict: "ticker" })
      .select("id")
      .single();
    if (stockError) throw new Error(`Supabase stocks save failed (${item.stock.ticker}): ${stockError.message}`);

    const stockId = stock.id as string;
    const priceRows = item.prices.map((priceRow) => ({
      stock_id: stockId,
      date: priceRow.date,
      open: priceRow.open,
      high: priceRow.high,
      low: priceRow.low,
      close: priceRow.close,
      volume: priceRow.volume,
      change_percent: priceRow.changePercent,
      volume_average20: priceRow.volumeAverage20,
      volume_ratio: priceRow.volumeRatio,
      intraday_range_percent: priceRow.intradayRangePercent,
      rsi: priceRow.rsi,
      macd: priceRow.macd,
      macd_signal: priceRow.macdSignal,
      macd_histogram: priceRow.macdHistogram,
      macd_direction: priceRow.macdDirection,
      ma5: priceRow.ma5,
      ma20: priceRow.ma20,
      ma50: priceRow.ma50,
      score: priceRow.score,
      pattern: priceRow.pattern,
      source: priceRow.source
    }));
    const { error: priceError } = await supabase.from("daily_prices").upsert(priceRows, { onConflict: "stock_id,date" });
    if (priceError) throw new Error(`Supabase daily_prices save failed (${item.stock.ticker}): ${priceError.message}`);

    if (item.news.length > 0) {
      const { error: newsError } = await supabase.from("news").insert(item.news.map((newsItem) => ({
        stock_id: stockId,
        title: newsItem.title,
        source: newsItem.source,
        published_at: newsItem.publishedAt,
        summary: newsItem.summary,
        sentiment: newsItem.sentiment,
        impact_score: newsItem.impactScore,
        risk: newsItem.risk,
        opportunity: newsItem.opportunity,
        ai_comment: newsItem.aiComment
      })));
      if (newsError) throw new Error(`Supabase news save failed (${item.stock.ticker}): ${newsError.message}`);
    }
  }

  const { error: tasksError } = await supabase.from("ai_tasks").insert(result.tasks.map((task) => ({
    name: task.name,
    role: task.role,
    task: task.task,
    status: task.status,
    last_run: task.lastRun,
    next_run: task.nextRun,
    result: task.result,
    error: task.error
  })));
  if (tasksError) throw new Error(`Supabase ai_tasks save failed: ${tasksError.message}`);

  const { error: reportError } = await supabase.from("daily_reports").upsert({
    report_date: result.report.date,
    market: result.report.market,
    watchlist: result.report.watchlist,
    news: result.report.news,
    decision: result.report.decision,
    tomorrow: result.report.tomorrow
  }, { onConflict: "report_date" });
  if (reportError) throw new Error(`Supabase daily_reports save failed: ${reportError.message}`);

  const { error: runError } = await supabase.from("job_runs").insert({
    status: result.status,
    mode: result.mode,
    last_run: result.lastRun,
    next_run: result.nextRun,
    data_freshness: result.dataFreshness,
    ai_market_score: result.aiMarketScore,
    error: result.error,
    warning: result.warning,
    result
  });
  if (runError) throw new Error(`Supabase job_runs save failed: ${runError.message}`);

  return { saved: true };
}
