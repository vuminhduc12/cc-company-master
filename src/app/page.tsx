"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AiEmployeeCard } from "@/components/AiEmployeeCard";
import { LiveWatchlistStrip } from "@/components/LiveWatchlistStrip";
import { DataTable } from "@/components/DataTable";
import { FinanceDashboardChart, type IntradayPoint } from "@/components/FinanceDashboardChart";
import { NewsCard } from "@/components/NewsCard";
import { ScoreBreakdown } from "@/components/ScoreBreakdown";
import { StatCard } from "@/components/StatCard";
import { StatusBadge } from "@/components/StatusBadge";
import { StockChart } from "@/components/StockChart";
import { resolveAiJobAudit } from "@/lib/ai-job-audit";
import { stockDataProviderPriorityLabel } from "@/lib/data-provider-policy";
import { latestPrice, resolvePriceSeries, volumeRatio } from "@/lib/indicators";
import { aiTasks, news, prices, pricesByTicker, report, watchlist } from "@/lib/mock-data";
import { analyzeStock, statusFromScore } from "@/lib/scoring";
import { HISTORY_POLL_MS } from "@/lib/stock-history-cache";
import { useUserWatchlist } from "@/lib/user-watchlist";
import { useAiJobResult } from "@/lib/use-ai-job-result";
import type { AiStockExecutionAudit, DailyPrice, NewsItem, Stock, WatchStatus, WatchlistItem } from "@/types";

type RealtimeQuote = {
  ok: boolean;
  ticker: string;
  yahooSymbol: string;
  source: string;
  marketState: string;
  regular: {
    price: number;
    previousClose: number | null;
    change: number | null;
    changePercent: number | null;
    currency: string;
    asOf: string;
  };
  extended: {
    session: "pre" | "post";
    label: string;
    price: number;
    change: number | null;
    changePercent: number | null;
    asOf: string;
  } | null;
  summary: {
    exchange: string | null;
    dayRange: { low: number | null; high: number | null };
    yearRange: { low: number | null; high: number | null };
    marketCap: number | null;
    averageVolume: number | null;
    instrumentType: string | null;
  };
  intraday: IntradayPoint[];
  fetchedAt: string;
};

type HistoryApiResult = {
  ok: true;
  stock: Stock;
  prices: DailyPrice[];
  price: DailyPrice;
  news: NewsItem[];
  score: number;
  status: WatchStatus;
  mode: "live" | "mock";
  provider: "yahoo" | "alpha_vantage" | "saved" | "local";
  sourceLabel: string;
  warning?: string;
  fetchedAt: string;
};

export default function DashboardPage() {
  const [selectedTicker, setSelectedTicker] = useState("RGTI");
  const [realtimeQuote, setRealtimeQuote] = useState<RealtimeQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [historyData, setHistoryData] = useState<HistoryApiResult | null>(null);
  const [historyStatus, setHistoryStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [historyError, setHistoryError] = useState("");
  const jobResult = useAiJobResult();
  const executionAudit = resolveAiJobAudit(jobResult);
  const userWatchlist = useUserWatchlist();
  const dashboardWatchlist = userWatchlist.ready ? userWatchlist.items : watchlist;
  const baseLatest = latestPrice(prices);
  const selectedItem = dashboardWatchlist.find((item) => item.stock.ticker === selectedTicker) ?? dashboardWatchlist[0] ?? watchlist[0];
  const activeHistoryData = historyData?.stock.ticker === selectedItem.stock.ticker ? historyData : null;
  const selectedLive = jobResult?.stocks?.find((stockResult) => stockResult.stock.ticker === selectedItem.stock.ticker);
  const cachedHistory = userWatchlist.getTickerHistory(selectedItem.stock.ticker);
  const selectedBasePrices = activeHistoryData?.prices ?? cachedHistory?.prices ?? pricesByTicker[selectedItem.stock.ticker] ?? selectedLive?.prices ?? [latestPriceFromWatchItem(selectedItem)];
  const selectedLivePrice = selectedLive?.price ?? (selectedItem.stock.ticker === "RGTI" ? jobResult?.price : null) ?? activeHistoryData?.price ?? null;
  const resolvedPrices = resolvePriceSeries(selectedBasePrices, selectedLive?.prices ?? activeHistoryData?.prices, selectedLivePrice);
  const chartPrices = resolvedPrices.prices;
  const latest = chartPrices[chartPrices.length - 1] ?? baseLatest;
  const selectedNews = selectedLive?.news?.length
    ? selectedLive.news
    : activeHistoryData?.news?.length
      ? activeHistoryData.news
      : news.filter((item) => item.ticker === selectedItem.stock.ticker);
  const liveNews = selectedNews.length > 0 ? selectedNews : news;
  const scoreAnalysis = analyzeStock(latest, liveNews);
  const score = selectedLive?.aiMarketScore ?? (selectedItem.stock.ticker === "RGTI" && jobResult ? jobResult.aiMarketScore : scoreAnalysis.score);
  const status = selectedLive?.status ?? statusFromScore(score);
  const liveStatuses = dashboardWatchlist.map((item) => item.status);
  const bullish = liveStatuses.filter((itemStatus) => itemStatus === "Strong Buy" || itemStatus === "Buy").length;
  const caution = liveStatuses.filter((itemStatus) => itemStatus === "Caution").length;
  const danger = liveStatuses.filter((itemStatus) => itemStatus === "Sell").length;
  const liveTasks = jobResult?.tasks ?? aiTasks;
  const liveReport = jobResult?.report ?? report;
  const displayedPrice = realtimeQuote?.regular.price ?? latest.close;
  const regularPrice = realtimeQuote?.regular.price ?? latest.close;
  const regularPreviousClose = realtimeQuote?.regular.previousClose ?? chartPrices[chartPrices.length - 2]?.close ?? selectedItem.previousClose;
  const regularChange = realtimeQuote?.regular.change ?? (regularPrice - regularPreviousClose);
  const regularChangePercent = realtimeQuote?.regular.changePercent ?? (regularPreviousClose > 0 ? (regularChange / regularPreviousClose) * 100 : latest.changePercent);
  const quoteCurrency = realtimeQuote?.regular.currency ?? currencyForTicker(selectedItem.stock.ticker);
  const hasExtendedPrice = Boolean(realtimeQuote?.extended?.price);
  const selectedFinanceUrl = `https://www.google.com/finance/quote/${encodeURIComponent(selectedItem.stock.ticker)}:${encodeURIComponent(selectedItem.stock.exchange)}`;

  useEffect(() => {
    let cancelled = false;

    async function loadRealtimeQuote() {
      setQuoteLoading(true);
      try {
        const response = await fetch(`/api/quote/realtime?ticker=${encodeURIComponent(selectedTicker)}`, { cache: "no-store" });
        const payload = await response.json() as RealtimeQuote | { ok: false; error?: string };
        if (cancelled) return;
        if (!response.ok || !payload.ok) {
          setRealtimeQuote(null);
          setQuoteError("error" in payload ? payload.error ?? "リアルタイム株価を取得できませんでした。" : "リアルタイム株価を取得できませんでした。");
          return;
        }
        setRealtimeQuote(payload);
        setQuoteError(null);
      } catch (error) {
        if (!cancelled) {
          setRealtimeQuote(null);
          setQuoteError(error instanceof Error ? error.message : "リアルタイム株価を取得できませんでした。");
        }
      } finally {
        if (!cancelled) setQuoteLoading(false);
      }
    }

    loadRealtimeQuote();
    const timer = window.setInterval(loadRealtimeQuote, 60 * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [selectedTicker]);

  useEffect(() => {
    let cancelled = false;

    async function loadHistory() {
      setHistoryStatus("loading");
      setHistoryError("");
      try {
        const response = await fetch(`/api/stocks/${encodeURIComponent(selectedTicker)}/history`, { cache: "no-store" });
        const payload = await response.json() as HistoryApiResult | { ok: false; error?: string };
        if (cancelled) return;
        if (!response.ok || !payload.ok) {
          setHistoryData(null);
          setHistoryStatus("error");
          setHistoryError("error" in payload ? payload.error ?? "日足履歴を取得できませんでした。" : "日足履歴を取得できませんでした。");
          return;
        }
        setHistoryData(payload);
        setHistoryStatus("done");
      } catch (error) {
        if (!cancelled) {
          setHistoryData(null);
          setHistoryStatus("error");
          setHistoryError(error instanceof Error ? error.message : "日足履歴を取得できませんでした。");
        }
      }
    }

    void loadHistory();
    const timer = window.setInterval(() => {
      void loadHistory();
    }, HISTORY_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [selectedTicker, userWatchlist.historyRevision]);

  useEffect(() => {
    if (dashboardWatchlist.some((item) => item.stock.ticker === selectedTicker)) return;
    const fallbackTicker = dashboardWatchlist[0]?.stock.ticker;
    if (fallbackTicker) setSelectedTicker(fallbackTicker);
  }, [dashboardWatchlist, selectedTicker]);

  return (
    <div className="space-y-5 sm:space-y-7">
      <LiveWatchlistStrip />
      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-slate-50 text-slate-950 shadow-2xl shadow-black/20">
        <div className="border-b border-slate-200 bg-white px-3 py-3 sm:px-5">
          <div className="flex gap-2 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch]">
            {dashboardWatchlist.map((item) => {
              const currentPrice = item.currentPrice;
              const previousClose = item.previousClose;
              const change = previousClose > 0 ? ((currentPrice - previousClose) / previousClose) * 100 : 0;
              return (
                <MarketChip
                  key={item.stock.ticker}
                  ticker={item.stock.ticker}
                  price={currentPrice}
                  change={change}
                  currency={currencyForTicker(item.stock.ticker)}
                  active={item.stock.ticker === selectedItem.stock.ticker}
                  onClick={() => setSelectedTicker(item.stock.ticker)}
                />
              );
            })}
          </div>
        </div>

        <div className="grid gap-5 p-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:p-6 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="min-w-0">
            <div className="border-b border-slate-200 pb-5">
              <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-5xl font-black tracking-tight text-slate-950 sm:text-7xl">{selectedItem.stock.ticker}</h2>
                    <StatusBadge value={status} />
                  </div>
                  <p className="mt-2 text-sm font-semibold text-slate-500">{selectedItem.stock.exchange} · {selectedItem.stock.companyName}</p>
                  <div className="mt-4 flex flex-wrap items-end gap-3">
                    <p className="text-4xl font-black tracking-tight text-slate-950 tabular-nums sm:text-5xl">
                      {formatMoney(displayedPrice, quoteCurrency)}
                    </p>
                    <span className={regularChangePercent >= 0 ? "mb-1 rounded-lg bg-green-100 px-2.5 py-1.5 text-sm font-black text-green-700" : "mb-1 rounded-lg bg-red-100 px-2.5 py-1.5 text-sm font-black text-red-700"}>
                      {regularChangePercent >= 0 ? "+" : ""}{regularChangePercent.toFixed(2)}%
                    </span>
                    <span className={regularChange >= 0 ? "mb-2 text-sm font-semibold text-green-700" : "mb-2 text-sm font-semibold text-red-700"}>
                      {regularChange >= 0 ? "+" : ""}{formatMoney(regularChange, quoteCurrency)} 今日
                    </span>
                  </div>
                  <p className="mt-3 border-l-2 border-slate-300 pl-3 text-xs leading-5 text-slate-500">
                    参考情報です。最終判断はご自身でご確認ください
                  </p>
                  <p className="mt-2 text-xs leading-5 text-slate-500">
                    通常取引: {formatMoney(regularPrice, quoteCurrency)} / 終了: {formatDateTime(realtimeQuote?.regular.asOf)}
                    {quoteLoading ? " / 更新中..." : ""}
                  </p>
                  {realtimeQuote?.extended ? (
                    <p className={realtimeQuote.extended.changePercent && realtimeQuote.extended.changePercent >= 0 ? "mt-1 text-sm font-bold text-green-700" : "mt-1 text-sm font-bold text-red-700"}>
                      {realtimeQuote.extended.label}: {formatMoney(realtimeQuote.extended.price, quoteCurrency)}
                      {realtimeQuote.extended.changePercent !== null ? ` (${realtimeQuote.extended.changePercent >= 0 ? "+" : ""}${realtimeQuote.extended.changePercent.toFixed(2)}%)` : ""} / {formatDateTime(realtimeQuote.extended.asOf)}
                    </p>
                  ) : (
                    <p className="mt-1 text-sm font-semibold text-slate-500">{quoteError ? `リアルタイム取得失敗: ${quoteError}` : "時間外価格は現在未配信です。"}</p>
                  )}
                </div>
                <div className="flex w-full flex-col gap-3 md:w-auto md:shrink-0 md:items-end">
                  <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 text-sm shadow-sm">
                    <p className="text-xs font-semibold text-slate-500">AI スコア</p>
                    <p className="mt-1 text-5xl font-black tracking-tight text-slate-950 tabular-nums">{score}</p>
                  </div>
                  <div className="flex gap-2">
                    <Link className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-100" href={`/stocks/${selectedItem.stock.ticker}`}>
                      詳細
                    </Link>
                    <a className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-blue-700 shadow-sm hover:bg-blue-50" href={selectedFinanceUrl} target="_blank" rel="noreferrer">
                      Google Finance
                    </a>
                  </div>
                </div>
              </div>
            </div>

            <div className="max-w-full overflow-x-hidden">
              <FinanceDashboardChart
                prices={chartPrices}
                ticker={selectedItem.stock.ticker}
                intraday={realtimeQuote?.intraday ?? []}
                previousClose={regularPreviousClose}
                extendedPrice={hasExtendedPrice ? realtimeQuote?.extended?.price ?? null : null}
              />
            </div>
          </div>

          <aside className="min-w-0 space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h3 className="text-lg font-bold text-slate-950">主要指標</h3>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">{realtimeQuote?.marketState ?? "LOCAL"}</span>
              </div>
              <div className="divide-y divide-slate-200">
                <FactRow label="前日の終値" value={formatMoney(regularPreviousClose, quoteCurrency)} />
                <FactRow label="日次変動幅" value={formatRange(realtimeQuote?.summary.dayRange.low, realtimeQuote?.summary.dayRange.high, quoteCurrency, `${formatMoney(latest.low, quoteCurrency)} - ${formatMoney(latest.high, quoteCurrency)}`)} />
                <FactRow label="年間変動幅" value={formatRange(realtimeQuote?.summary.yearRange.low, realtimeQuote?.summary.yearRange.high, quoteCurrency)} />
                <FactRow label="時価総額" value={formatLargeNumber(realtimeQuote?.summary.marketCap, quoteCurrency)} />
                <FactRow label="平均取引高" value={formatLargeNumber(realtimeQuote?.summary.averageVolume, "")} />
                <FactRow label="RSI" value={latest.rsi.toFixed(2)} />
                <FactRow label="MA20 / MA50" value={`${formatMoney(latest.ma20, quoteCurrency)} / ${formatMoney(latest.ma50, quoteCurrency)}`} />
                <FactRow label="優先市場" value={selectedItem.stock.exchange} />
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="font-bold text-slate-950">概要</h3>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                {selectedItem.stock.companyName}は{selectedItem.stock.sector}関連銘柄です。通常取引価格、時間外価格、日足テクニカル、ニュース材料を同じ画面で確認できます。
              </p>
              <p className="mt-3 text-xs leading-5 text-slate-500">
                データソース: {activeHistoryData?.sourceLabel ?? realtimeQuote?.source ?? "ローカル履歴"} / 最終取得: {formatDateTime(activeHistoryData?.fetchedAt ?? realtimeQuote?.fetchedAt)}
              </p>
            </div>
          </aside>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-5">
        <StatCard label="Total Watchlist" value={dashboardWatchlist.length} />
        <StatCard label="Bullish Stocks" value={bullish} tone="green" />
        <StatCard label="Caution Stocks" value={caution} tone="yellow" />
        <StatCard label="Danger Stocks" value={danger} tone="red" />
        <StatCard label="AI Market Score" value={score} tone="blue" />
      </section>

      <section className="grid gap-4 md:grid-cols-4">
        <StatCard label="Last AI Run" value={jobResult?.lastRun ?? "未実行"} tone="gold" />
        <StatCard label="Next Scheduled Run" value={jobResult?.nextRun ?? "07:00 JST"} tone="blue" />
        <StatCard label="Data Freshness" value={selectedLive?.dataFreshness ?? activeHistoryData?.fetchedAt ?? (selectedItem.stock.ticker === "RGTI" ? jobResult?.dataFreshness : null) ?? latest.date} />
        <StatCard label="AI Job Status" value={jobResult?.status ?? "Pending"} tone={jobResult?.status === "Error" ? "red" : jobResult?.status === "Completed" ? "green" : "yellow"} />
      </section>

      <section className="rounded-2xl border border-emerald-300/20 bg-emerald-300/[0.06] p-4 text-sm leading-6 text-emerald-50">
        株価データ優先順位: <span className="font-black">{stockDataProviderPriorityLabel}</span>
        <span className="text-emerald-100/75">。Alpha Vantageは明示的に有効化した時だけ最後の補助として使用します。</span>
      </section>

      {jobResult?.error ? (
        <section className="rounded-2xl border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-200">
          AI Job Error: {jobResult.error}
        </section>
      ) : null}
      {jobResult?.warning ? (
        <section className="rounded-2xl border border-yellow-300/30 bg-yellow-300/10 p-4 text-sm leading-6 text-yellow-100">
          AI Job Warning: {jobResult.warning}
        </section>
      ) : null}
      {resolvedPrices.rejectedLive ? (
        <section className="rounded-2xl border border-yellow-300/30 bg-yellow-300/10 p-4 text-sm leading-6 text-yellow-100">
          Data Warning: APIから取得した{selectedItem.stock.ticker}価格がローカル検証済み履歴と大きく異なるため、画面ではローカル履歴を優先表示しています。
        </section>
      ) : null}
      {activeHistoryData?.warning ? (
        <section className="rounded-2xl border border-yellow-300/30 bg-yellow-300/10 p-4 text-sm leading-6 text-yellow-100">
          History Warning: {activeHistoryData.warning}
        </section>
      ) : null}
      {historyStatus === "error" && !pricesByTicker[selectedItem.stock.ticker] && !selectedLive?.prices?.length ? (
        <section className="rounded-2xl border border-yellow-300/30 bg-yellow-300/10 p-4 text-sm leading-6 text-yellow-100">
          History Notice: {selectedItem.stock.ticker}の日足履歴を取得できなかったため、Watchlist保存価格で暫定表示しています。{historyError}
        </section>
      ) : null}

      <section>
        <SectionTitle title="AI Execution Visibility" note="AI実行履歴、データ鮮度、429時のルール分析切替を銘柄ごとに確認" />
        <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <AuditTile label="完了銘柄" value={executionAudit ? `${executionAudit.completedStocks}/${executionAudit.totalStocks}` : "-"} tone={executionAudit?.failedStocks ? "yellow" : "green"} />
          <AuditTile label="AI分析ニュース" value={executionAudit?.aiNewsCount ?? "-"} tone="blue" />
          <AuditTile label="ルール代替ニュース" value={executionAudit?.ruleNewsCount ?? "-"} tone={executionAudit?.ruleNewsCount ? "yellow" : "green"} />
          <AuditTile label="最新ニュース日" value={executionAudit?.latestNewsDate ?? "-"} />
        </div>
        {executionAudit ? (
          <>
            <div className="space-y-3 md:hidden">
              {executionAudit.stocks.map((item) => <AuditMobileCard key={item.ticker} item={item} />)}
            </div>
            <div className="hidden md:block">
              <DataTable
                headers={["Ticker", "状態", "株価ソース", "株価鮮度", "News", "AI/Rule", "フォールバック理由"]}
                rows={executionAudit.stocks.map((item) => [
                  <span key="ticker" className="font-black text-sky-200">{item.ticker}</span>,
                  <AuditPill key="status" label={item.status === "Error" ? "Error" : "Completed"} tone={item.status === "Error" ? "red" : "green"} />,
                  item.priceSource,
                  item.priceFreshness,
                  `${item.newsCount}件${item.latestNewsDate ? ` / 最新 ${item.latestNewsDate}` : ""}`,
                  <span key="mode" className="font-bold text-slate-100">AI {item.aiNewsCount} / Rule {item.ruleNewsCount}</span>,
                  item.fallbackReason || item.warning || "-"
                ])}
              />
            </div>
          </>
        ) : (
          <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-5 text-sm leading-6 text-slate-400">
            Manual AI Jobがまだ実行されていません。実行後に銘柄ごとの取得・分析履歴が表示されます。
          </div>
        )}
      </section>

      <section className="grid min-w-0 gap-5 xl:grid-cols-[340px_minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
          <SectionTitle title="Watchlist" note="銘柄をクリックすると中央の分析が切り替わります" />
          <div className="space-y-2">
            {dashboardWatchlist.map((item) => {
              const currentPrice = item.currentPrice;
              const previousClose = item.previousClose;
              const change = previousClose > 0 ? ((currentPrice - previousClose) / previousClose) * 100 : 0;
              const rowStatus = item.status;
              const active = item.stock.ticker === selectedItem.stock.ticker;
              return (
                <button
                  key={item.stock.ticker}
                  className={`grid w-full grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 rounded-2xl border p-3 text-left shadow-lg shadow-black/15 transition ${
                    active
                      ? "border-sky-300/55 bg-sky-300/10 ring-1 ring-sky-200/20"
                      : "border-white/10 bg-slate-900/80 hover:border-sky-300/30 hover:bg-slate-900"
                  }`}
                  onClick={() => setSelectedTicker(item.stock.ticker)}
                >
                  <span className="min-w-0">
                    <span className={active ? "block text-base font-black text-sky-100" : "block text-base font-black text-slate-100"}>{item.stock.ticker}</span>
                    <span className="mt-0.5 block truncate text-xs font-semibold text-slate-500">{shortCompanyName(item.stock.companyName)}</span>
                  </span>
                  <span className="text-right tabular-nums">
                    <span className="block text-sm font-black text-slate-100">{currentPrice ? formatMoney(currentPrice, currencyForTicker(item.stock.ticker)) : "-"}</span>
                    <span className={change >= 0 ? "mt-0.5 block text-xs font-bold text-green-300" : "mt-0.5 block text-xs font-bold text-red-300"}>
                      {change ? `${change >= 0 ? "+" : ""}${change.toFixed(2)}%` : "-"}
                    </span>
                  </span>
                  <WatchStatusPill value={rowStatus} />
                </button>
              );
            })}
          </div>
        </div>

        <div className="min-w-0 overflow-x-hidden">
          <StockChart prices={chartPrices} ticker={selectedItem.stock.ticker} />
        </div>

        <aside className="min-w-0 space-y-4">
          <div className="rounded-2xl border border-sky-300/20 bg-slate-900/80 p-5 shadow-xl shadow-black/25">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm text-slate-400">{selectedItem.stock.ticker} / {selectedItem.stock.companyName}</p>
                <p className="mt-2 text-3xl font-bold text-slate-50 sm:text-4xl">${latest.close.toFixed(2)}</p>
              </div>
              <StatusBadge value={status} />
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
              <Metric label="前日比" value={`${latest.changePercent.toFixed(2)}%`} tone={latest.changePercent >= 0 ? "green" : "red"} />
              <Metric label="出来高" value={`${Math.round(latest.volume / 1000000)}M`} />
              <Metric label="RSI" value={latest.rsi.toFixed(2)} tone={latest.rsi >= 69 ? "yellow" : "green"} />
              <Metric label="出来高倍率" value={`${volumeRatio(latest).toFixed(2)}x`} tone="blue" />
              <Metric label="MACD方向" value={latest.macdDirection} tone="green" />
              <Metric label="MA20 / MA50" value={`$${latest.ma20.toFixed(2)} / $${latest.ma50.toFixed(2)}`} />
            </div>
            <Link className="mt-4 inline-flex rounded-full border border-sky-300/30 px-3 py-2 text-xs font-bold text-sky-200 hover:bg-sky-300/10" href={`/stocks/${selectedItem.stock.ticker}`}>
              詳細ページを開く
            </Link>
          </div>

          <div className={latest.rsi >= 70 || selectedLive?.warning || activeHistoryData?.warning ? "rounded-2xl border border-yellow-300/25 bg-yellow-300/10 p-5" : "rounded-2xl border border-sky-300/20 bg-sky-300/10 p-5"}>
            <div className="flex items-center justify-between">
              <h3 className={latest.rsi >= 70 || selectedLive?.warning || activeHistoryData?.warning ? "font-semibold text-yellow-100" : "font-semibold text-sky-100"}>
                {selectedLive?.warning || activeHistoryData?.warning ? "Data Warning" : latest.rsi >= 70 ? "Warning" : "AI Note"}
              </h3>
              <StatusBadge value={latest.rsi >= 70 || selectedLive?.warning || activeHistoryData?.warning ? "Caution" : status} />
            </div>
            <p className={latest.rsi >= 70 || selectedLive?.warning || activeHistoryData?.warning ? "mt-3 text-sm leading-6 text-yellow-100/85" : "mt-3 text-sm leading-6 text-sky-100/85"}>
              {selectedLive?.warning ?? activeHistoryData?.warning ?? `${selectedItem.stock.ticker}はRSI ${latest.rsi.toFixed(2)}、出来高倍率 ${volumeRatio(latest).toFixed(2)}x です。MA20維持とニュース材料を確認してください。`}
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-5 shadow-xl shadow-black/20 ring-1 ring-white/5">
            <h3 className="font-semibold text-slate-50">判定根拠</h3>
            <p className="mt-2 text-sm leading-6 text-slate-300">{scoreAnalysis.summary}</p>
            <div className="mt-4">
              <ScoreBreakdown factors={scoreAnalysis.factors} score={scoreAnalysis.score} status={status} />
            </div>
          </div>
        </aside>
      </section>

      <section className="grid min-w-0 gap-5 xl:grid-cols-3">
        <div className="min-w-0 xl:col-span-2">
          <SectionTitle title="AI News Analysis" note="選択中の銘柄に関係するニュースを優先表示" />
          <div className="grid gap-4 lg:grid-cols-2">
            {liveNews.slice(0, 2).map((item, index) => <NewsCard key={`${item.ticker}-${item.publishedAt}-${item.url ?? item.title}-${index}`} item={item} />)}
          </div>
        </div>
        <div>
          <SectionTitle title="Daily Report Summary" note="今日の結論と明日の確認ポイント" />
          <div className="rounded-2xl border border-white/10 bg-slate-900/75 p-5 shadow-lg shadow-black/20">
            <p className="text-xs text-slate-400">{liveReport.date}</p>
            <p className="mt-3 whitespace-pre-line text-sm leading-6 text-slate-200">{selectedLive?.report.decision ?? liveReport.decision}</p>
            <p className="mt-3 whitespace-pre-line text-sm leading-6 text-slate-400">{selectedLive?.report.tomorrow ?? liveReport.tomorrow}</p>
          </div>
        </div>
      </section>

      <section>
        <SectionTitle title="AI Employees Task Status" note="データ取得・ニュース分析・リスク確認の実行状況" />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          {liveTasks.map((task) => <AiEmployeeCard key={task.name} task={task} />)}
        </div>
      </section>
    </div>
  );
}

function latestPriceFromWatchItem(item: WatchlistItem): DailyPrice {
  const currentPrice = Number.isFinite(item.currentPrice) && item.currentPrice > 0 ? item.currentPrice : 0.01;
  const previousClose = Number.isFinite(item.previousClose) && item.previousClose > 0 ? item.previousClose : currentPrice;
  const changePercent = previousClose > 0 ? ((currentPrice - previousClose) / previousClose) * 100 : 0;
  return {
    date: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo" }),
    open: previousClose,
    high: Math.max(currentPrice, previousClose),
    low: Math.min(currentPrice, previousClose),
    close: currentPrice,
    volume: 0,
    changePercent,
    volumeAverage20: 0,
    volumeRatio: 0,
    intradayRangePercent: currentPrice > 0 ? ((Math.abs(currentPrice - previousClose)) / currentPrice) * 100 : 0,
    rsi: 50,
    macd: 0,
    macdSignal: 0,
    macdHistogram: 0,
    macdDirection: changePercent >= 0 ? "上昇" : "低下",
    rsiSignal: "中立",
    high20Breakout: "",
    ma5: currentPrice,
    ma20: currentPrice,
    ma50: currentPrice,
    volumeAverage: 0,
    closeAfter5Days: null,
    changeAfter5Days: null,
    closeAfter10Days: null,
    changeAfter10Days: null,
    score: 0,
    pattern: "",
    comment: "Watchlist追加銘柄の最新価格から生成",
    source: "User Watchlist"
  };
}

function AuditMobileCard({ item }: { item: AiStockExecutionAudit }) {
  return (
    <article className="rounded-2xl border border-white/10 bg-slate-900/82 p-4 shadow-lg shadow-black/20 ring-1 ring-white/5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-lg font-black text-sky-100">{item.ticker}</p>
          <p className="mt-1 text-xs text-slate-500">{item.priceSource} / {item.priceFreshness}</p>
        </div>
        <AuditPill label={item.status === "Error" ? "Error" : "Completed"} tone={item.status === "Error" ? "red" : "green"} />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
        <MobileAuditMetric label="News" value={`${item.newsCount}件${item.latestNewsDate ? ` / ${item.latestNewsDate}` : ""}`} />
        <MobileAuditMetric label="AI / Rule" value={`${item.aiNewsCount} / ${item.ruleNewsCount}`} />
      </div>
      {item.fallbackReason || item.warning ? (
        <p className="mt-3 rounded-xl border border-yellow-300/20 bg-yellow-300/10 px-3 py-2 text-xs leading-5 text-yellow-100">
          {item.fallbackReason || item.warning}
        </p>
      ) : null}
    </article>
  );
}

function MobileAuditMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-950/55 p-3">
      <p className="text-[11px] font-semibold text-slate-500">{label}</p>
      <p className="mt-1 break-words font-bold text-slate-100">{value}</p>
    </div>
  );
}

function MarketChip({
  ticker,
  price,
  change,
  currency,
  active,
  onClick
}: {
  ticker: string;
  price: number;
  change: number;
  currency: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={active
        ? "flex min-w-[156px] items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-left shadow-sm"
        : "flex min-w-[156px] items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left shadow-sm hover:bg-slate-50"}
      onClick={onClick}
    >
      <span className={change >= 0 ? "grid size-9 place-items-center rounded-lg bg-green-100 text-lg font-bold text-green-700" : "grid size-9 place-items-center rounded-lg bg-red-100 text-lg font-bold text-red-700"}>
        {change >= 0 ? "↑" : "↓"}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-bold text-slate-950">{ticker}</span>
        <span className="block truncate text-xs text-slate-500">{formatMoney(price, currency)} / <span className={change >= 0 ? "text-green-700" : "text-red-700"}>{change >= 0 ? "+" : ""}{change.toFixed(2)}%</span></span>
      </span>
    </button>
  );
}

function WatchStatusPill({ value }: { value: WatchStatus | "Danger" }) {
  const className = {
    "Strong Buy": "border-green-300/35 bg-green-300/10 text-green-200",
    Buy: "border-green-300/35 bg-green-300/10 text-green-200",
    Watch: "border-slate-400/35 bg-slate-400/10 text-slate-300",
    Caution: "border-yellow-300/35 bg-yellow-300/10 text-yellow-200",
    Sell: "border-red-300/35 bg-red-300/10 text-red-200",
    Danger: "border-red-300/35 bg-red-300/10 text-red-200"
  }[value];

  return (
    <span className={`inline-flex min-w-[78px] justify-center rounded-full border px-2.5 py-1 text-[11px] font-black ${className}`}>
      {value}
    </span>
  );
}

function shortCompanyName(companyName: string) {
  return companyName
    .replace(/\bComputing\b/gi, "")
    .replace(/\bInc\.?\b/gi, "")
    .replace(/\bCorporation\b/gi, "")
    .replace(/\s+/g, " ")
    .trim() || companyName;
}

function currencyForTicker(ticker: string) {
  return /^\d{4}(\.T|\.JP)?$/i.test(ticker) ? "JPY" : "USD";
}

function FactRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 py-3 text-sm">
      <span className="min-w-0 text-slate-500">{label}</span>
      <span className="max-w-[180px] text-right font-bold text-slate-900">{value}</span>
    </div>
  );
}

function SectionTitle({ title, note }: { title: string; note: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-lg font-bold text-slate-50">{title}</h2>
      <p className="mt-1 text-xs text-slate-500">{note}</p>
    </div>
  );
}

function AuditTile({ label, value, tone = "default" }: { label: string; value: string | number; tone?: "default" | "green" | "yellow" | "blue" }) {
  const color = {
    default: "text-slate-50",
    green: "text-emerald-300",
    yellow: "text-yellow-300",
    blue: "text-sky-300"
  }[tone];

  return (
    <div className="rounded-2xl border border-white/10 bg-slate-900/82 p-4 shadow-xl shadow-black/20 ring-1 ring-white/5">
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p className={`mt-2 break-words text-xl font-black ${color}`}>{value}</p>
    </div>
  );
}

function AuditPill({ label, tone }: { label: string; tone: "green" | "red" | "yellow" }) {
  const className = {
    green: "border-emerald-300/35 bg-emerald-300/10 text-emerald-100",
    red: "border-red-300/35 bg-red-300/10 text-red-100",
    yellow: "border-yellow-300/35 bg-yellow-300/10 text-yellow-100"
  }[tone];

  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-black ${className}`}>{label}</span>;
}

function formatMoney(value: number | null | undefined, currency: string) {
  if (!Number.isFinite(value)) return "-";
  const prefix = currency === "JPY" ? "¥" : "$";
  const digits = currency === "JPY" ? 0 : 2;
  return `${prefix}${Number(value).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  })}`;
}

function formatRange(low: number | null | undefined, high: number | null | undefined, currency: string, fallback = "-") {
  if (!Number.isFinite(low) || !Number.isFinite(high)) return fallback;
  return `${formatMoney(low, currency)} - ${formatMoney(high, currency)}`;
}

function formatLargeNumber(value: number | null | undefined, currency: string) {
  if (!Number.isFinite(value)) return "-";
  const prefix = currency === "JPY" ? "¥" : currency === "USD" ? "$" : "";
  const number = Number(value);
  if (number >= 1_000_000_000_000) return `${prefix}${(number / 1_000_000_000_000).toFixed(2)}T`;
  if (number >= 1_000_000_000) return `${prefix}${(number / 1_000_000_000).toFixed(2)}B`;
  if (number >= 1_000_000) return `${prefix}${(number / 1_000_000).toFixed(2)}M`;
  return `${prefix}${Math.round(number).toLocaleString("en-US")}`;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function Metric({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "green" | "red" | "yellow" | "blue" }) {
  const color = {
    default: "text-slate-50",
    green: "text-green-400",
    red: "text-red-400",
    yellow: "text-yellow-300",
    blue: "text-sky-300"
  }[tone];

  return (
    <div className="rounded-xl bg-slate-950/60 p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`mt-1 font-semibold ${color}`}>{value}</p>
    </div>
  );
}
