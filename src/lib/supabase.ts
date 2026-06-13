import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AiJobResult, DailyPrice, NewsItem } from "@/types";

let browserSupabase: SupabaseClient | null = null;
const jobRunPriceSnapshotLimit = 260;
const jobRunNewsSnapshotLimit = 60;
const jobRunStockNewsSnapshotLimit = 12;

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
  browserSupabase ??= createClient(normalizeSupabaseUrl(url), key);
  return browserSupabase;
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

export async function loadSavedPricesForTicker(ticker: string) {
  const supabase = createServerSupabase();
  if (!supabase) return [];

  const { data: stock, error: stockError } = await supabase
    .from("stocks")
    .select("id")
    .eq("ticker", ticker)
    .maybeSingle();
  if (stockError || !stock?.id) return [];

  const { data, error } = await supabase
    .from("daily_prices")
    .select("*")
    .eq("stock_id", stock.id)
    .order("date", { ascending: true });
  if (error || !data?.length) return [];

  return data.map((row) => dailyPriceFromRow(row as SavedDailyPriceRow));
}

export async function loadSavedNewsForTicker(ticker: string) {
  const supabase = createServerSupabase();
  if (!supabase) return [];

  const { data: stock, error: stockError } = await supabase
    .from("stocks")
    .select("id")
    .eq("ticker", ticker)
    .maybeSingle();
  if (stockError || !stock?.id) return [];

  const { data, error } = await supabase
    .from("news")
    .select("*")
    .eq("stock_id", stock.id)
    .order("published_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(20);
  if (error || !data?.length) return [];

  return data.map((row) => newsFromRow(row as SavedNewsRow, ticker));
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
    for (const chunk of chunkRows(priceRows, 500)) {
      const { error: priceError } = await supabase.from("daily_prices").upsert(chunk, { onConflict: "stock_id,date" });
      if (priceError) throw new Error(`Supabase daily_prices save failed (${item.stock.ticker}): ${priceError.message}`);
    }

    if (item.news.length > 0) {
      const newsRows = uniqueNewsRows(item.news.map((newsItem) => ({
        stock_id: stockId,
        title: newsItem.title,
        url: newsItem.url,
        source: newsItem.source,
        published_at: newsItem.publishedAt,
        summary: newsItem.summary,
        sentiment: newsItem.sentiment,
        impact_score: newsItem.impactScore,
        risk: newsItem.risk,
        opportunity: newsItem.opportunity,
        ai_comment: newsItem.aiComment
      })));
      for (const chunk of chunkRows(newsRows, 100)) {
        const { error: newsError } = await supabase.from("news").upsert(chunk, { onConflict: "stock_id,published_at,title,source" });
        if (newsError) throw new Error(`Supabase news save failed (${item.stock.ticker}): ${newsError.message}`);
      }
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

  const compactResult = compactJobResultForRun(result);
  const { error: runError } = await supabase.from("job_runs").insert({
    status: result.status,
    mode: result.mode,
    last_run: result.lastRun,
    next_run: result.nextRun,
    data_freshness: result.dataFreshness,
    ai_market_score: result.aiMarketScore,
    error: result.error,
    warning: result.warning,
    result: compactResult
  });
  if (runError) return { saved: false, reason: `Supabase job_runs save failed: ${runError.message}` };

  return { saved: true };
}

function compactJobResultForRun(result: AiJobResult): AiJobResult {
  return {
    ...result,
    news: result.news.slice(0, jobRunNewsSnapshotLimit),
    stocks: result.stocks?.map((stock) => ({
      ...stock,
      prices: stock.prices.slice(-jobRunPriceSnapshotLimit),
      news: stock.news.slice(0, jobRunStockNewsSnapshotLimit)
    }))
  };
}

type NewsRow = {
  stock_id: string;
  title: string;
  url?: string;
  source: string;
  published_at: string;
  summary: string;
  sentiment: string;
  impact_score: number;
  risk: string;
  opportunity: string;
  ai_comment: string;
};

type SavedDailyPriceRow = {
  date: string;
  open: number | string | null;
  high: number | string | null;
  low: number | string | null;
  close: number | string | null;
  volume: number | string | null;
  change_percent: number | string | null;
  volume_average20: number | string | null;
  volume_ratio: number | string | null;
  intraday_range_percent: number | string | null;
  rsi: number | string | null;
  macd: number | string | null;
  macd_signal: number | string | null;
  macd_histogram: number | string | null;
  macd_direction: string | null;
  ma5: number | string | null;
  ma20: number | string | null;
  ma50: number | string | null;
  score: number | string | null;
  pattern: string | null;
  source: string | null;
};

type SavedNewsRow = {
  title: string;
  url?: string | null;
  source?: string | null;
  published_at?: string | null;
  summary?: string | null;
  sentiment?: string | null;
  impact_score?: number | string | null;
  risk?: string | null;
  opportunity?: string | null;
  ai_comment?: string | null;
};

function uniqueNewsRows(rows: NewsRow[]) {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = `${row.stock_id}|${row.published_at}|${row.title}|${row.source}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dailyPriceFromRow(row: SavedDailyPriceRow): DailyPrice {
  const close = numberFrom(row.close);
  const volumeAverage20 = numberFrom(row.volume_average20);
  const volumeRatio = numberFrom(row.volume_ratio);
  const rsi = numberFrom(row.rsi) || 50;
  const score = numberFrom(row.score);
  return {
    date: String(row.date),
    open: numberFrom(row.open),
    high: numberFrom(row.high),
    low: numberFrom(row.low),
    close,
    volume: numberFrom(row.volume),
    changePercent: numberFrom(row.change_percent),
    volumeAverage20,
    volumeRatio,
    intradayRangePercent: numberFrom(row.intraday_range_percent),
    rsi,
    macd: numberFrom(row.macd),
    macdSignal: numberFrom(row.macd_signal),
    macdHistogram: numberFrom(row.macd_histogram),
    macdDirection: row.macd_direction === "低下" ? "低下" : "上昇",
    rsiSignal: rsi >= 70 ? "過熱" : rsi >= 55 ? "強気圏" : rsi <= 35 ? "弱気圏" : "中立",
    high20Breakout: "",
    ma5: numberFrom(row.ma5) || close,
    ma20: numberFrom(row.ma20) || close,
    ma50: numberFrom(row.ma50) || close,
    volumeAverage: volumeAverage20,
    closeAfter5Days: null,
    changeAfter5Days: null,
    closeAfter10Days: null,
    changeAfter10Days: null,
    score,
    pattern: row.pattern ?? "",
    comment: "Manual AI Jobで保存済みの履歴です。",
    source: row.source ? `${row.source} / Supabase saved` : "Supabase saved history"
  };
}

function newsFromRow(row: SavedNewsRow, ticker: string): NewsItem {
  const sentiment = row.sentiment === "Positive" || row.sentiment === "Negative" || row.sentiment === "Neutral"
    ? row.sentiment
    : "Neutral";
  return {
    title: row.title,
    url: row.url ?? undefined,
    source: row.source ?? "Supabase saved news",
    publishedAt: row.published_at ?? "",
    ticker,
    summary: row.summary ?? "保存済みニュースです。",
    sentiment,
    impactScore: numberFrom(row.impact_score) || 5,
    risk: row.risk ?? "保存済み分析を表示しています。",
    opportunity: row.opportunity ?? "保存済み分析を表示しています。",
    aiComment: row.ai_comment ?? "Manual AI Jobで保存済みのニュース分析です。"
  };
}

function numberFrom(value: number | string | null | undefined) {
  const numberValue = Number(value ?? 0);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function chunkRows<T>(rows: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }
  return chunks;
}
