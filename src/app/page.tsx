"use client";

import Link from "next/link";
import { useState } from "react";
import { AiEmployeeCard } from "@/components/AiEmployeeCard";
import { DataTable } from "@/components/DataTable";
import { NewsCard } from "@/components/NewsCard";
import { StatCard } from "@/components/StatCard";
import { StatusBadge } from "@/components/StatusBadge";
import { StockChart } from "@/components/StockChart";
import { latestPrice, resolvePriceSeries, volumeRatio } from "@/lib/indicators";
import { aiTasks, news, prices, pricesByTicker, report, watchlist } from "@/lib/mock-data";
import { analyzeStock, statusFromScore } from "@/lib/scoring";
import { useAiJobResult } from "@/lib/use-ai-job-result";

export default function DashboardPage() {
  const [selectedTicker, setSelectedTicker] = useState("RGTI");
  const jobResult = useAiJobResult();
  const baseLatest = latestPrice(prices);
  const selectedItem = watchlist.find((item) => item.stock.ticker === selectedTicker) ?? watchlist[0];
  const selectedLive = jobResult?.stocks?.find((stockResult) => stockResult.stock.ticker === selectedItem.stock.ticker);
  const selectedBasePrices = pricesByTicker[selectedItem.stock.ticker] ?? prices;
  const resolvedPrices = resolvePriceSeries(selectedBasePrices, selectedLive?.prices, selectedLive?.price ?? (selectedItem.stock.ticker === "RGTI" ? jobResult?.price : null));
  const chartPrices = resolvedPrices.prices;
  const latest = chartPrices[chartPrices.length - 1] ?? baseLatest;
  const selectedNews = selectedLive?.news?.length ? selectedLive.news : news.filter((item) => item.ticker === selectedItem.stock.ticker);
  const liveNews = selectedNews.length > 0 ? selectedNews : news;
  const scoreAnalysis = analyzeStock(latest, liveNews);
  const score = selectedLive?.aiMarketScore ?? (selectedItem.stock.ticker === "RGTI" && jobResult ? jobResult.aiMarketScore : scoreAnalysis.score);
  const status = selectedLive?.status ?? statusFromScore(score);
  const liveStatuses = watchlist.map((item) => jobResult?.stocks?.find((stockResult) => stockResult.stock.ticker === item.stock.ticker)?.status ?? item.status);
  const bullish = liveStatuses.filter((itemStatus) => itemStatus === "Strong Buy" || itemStatus === "Buy").length;
  const caution = liveStatuses.filter((itemStatus) => itemStatus === "Caution").length;
  const danger = liveStatuses.filter((itemStatus) => itemStatus === "Sell").length;
  const liveTasks = jobResult?.tasks ?? aiTasks;
  const liveReport = jobResult?.report ?? report;

  return (
    <div className="space-y-5 sm:space-y-7">
      <section className="overflow-hidden rounded-3xl border border-white/10 bg-slate-900/80 shadow-2xl shadow-black/30 ring-1 ring-white/5">
        <div className="grid gap-0 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="min-w-0 p-4 sm:p-7">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-sky-300/30 bg-sky-300/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-sky-200">Live Desk</span>
              <StatusBadge value={status} />
            </div>
            <h2 className="mt-4 text-2xl font-black leading-tight tracking-tight text-slate-50 sm:mt-5 sm:text-4xl">
              {selectedItem.stock.ticker}を中心に、価格・ニュース・AI判断を一画面で確認
            </h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-400">
              左で監視銘柄を選び、中央のチャートで値動き、右のAI判断でリスクとチャンスを確認できます。RGTI / SIDUは詳細ページにも遷移できます。
            </p>
          </div>
          <div className="min-w-0 border-t border-white/10 bg-slate-950/45 p-4 sm:p-7 lg:border-l lg:border-t-0">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Selected Stock</p>
            <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div className="min-w-0">
                <p className="text-4xl font-black text-slate-50 sm:text-5xl">{selectedItem.stock.ticker}</p>
                <p className="mt-2 text-sm text-slate-400">{selectedItem.stock.companyName}</p>
              </div>
              <div className={latest.changePercent >= 0 ? "text-left text-sky-300 sm:text-right" : "text-left text-red-300 sm:text-right"}>
                <p className="text-3xl font-black tabular-nums">${latest.close.toFixed(2)}</p>
                <p className="mt-1 text-sm font-bold">{latest.changePercent >= 0 ? "+" : ""}{latest.changePercent.toFixed(2)}%</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-5">
        <StatCard label="Total Watchlist" value={watchlist.length} />
        <StatCard label="Bullish Stocks" value={bullish} tone="green" />
        <StatCard label="Caution Stocks" value={caution} tone="yellow" />
        <StatCard label="Danger Stocks" value={danger} tone="red" />
        <StatCard label="AI Market Score" value={score} tone="blue" />
      </section>

      <section className="grid gap-4 md:grid-cols-4">
        <StatCard label="Last AI Run" value={jobResult?.lastRun ?? "未実行"} tone="gold" />
        <StatCard label="Next Scheduled Run" value={jobResult?.nextRun ?? "07:00 JST"} tone="blue" />
        <StatCard label="Data Freshness" value={selectedLive?.dataFreshness ?? (selectedItem.stock.ticker === "RGTI" ? jobResult?.dataFreshness : null) ?? latest.date} />
        <StatCard label="AI Job Status" value={jobResult?.status ?? "Pending"} tone={jobResult?.status === "Error" ? "red" : jobResult?.status === "Completed" ? "green" : "yellow"} />
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

      <section className="grid min-w-0 gap-5 xl:grid-cols-[340px_minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
          <SectionTitle title="Watchlist" note="銘柄をクリックすると中央の分析が切り替わります" />
          <DataTable
            headers={["Ticker", "Price", "Chg", "Status"]}
            rows={watchlist.map((item) => {
              const live = jobResult?.stocks?.find((stockResult) => stockResult.stock.ticker === item.stock.ticker);
              const rowBasePrices = pricesByTicker[item.stock.ticker];
              const rowResolved = rowBasePrices ? resolvePriceSeries(rowBasePrices, live?.prices, live?.price) : null;
              const rowLatest = rowResolved?.prices[rowResolved.prices.length - 1];
              const currentPrice = rowLatest?.close ?? live?.price.close ?? item.currentPrice;
              const previousClose = rowResolved?.prices[rowResolved.prices.length - 2]?.close ?? (live ? currentPrice / (1 + live.price.changePercent / 100) : item.previousClose);
              const change = previousClose > 0 ? ((currentPrice - previousClose) / previousClose) * 100 : 0;
              const hasDetail = Boolean(pricesByTicker[item.stock.ticker]);
              return [
                hasDetail ? (
                  <button
                    key="ticker"
                    className={item.stock.ticker === selectedItem.stock.ticker ? "font-bold text-yellow-200" : "font-bold text-sky-300 hover:text-sky-200"}
                    onClick={() => setSelectedTicker(item.stock.ticker)}
                  >
                    {item.stock.ticker}
                  </button>
                ) : (
                  <span key="ticker" className="font-bold text-slate-300">{item.stock.ticker}</span>
                ),
                currentPrice ? `$${currentPrice.toFixed(2)}` : "-",
                <span key="change" className={change >= 0 ? "font-semibold text-green-400" : "font-semibold text-red-400"}>{change ? `${change.toFixed(2)}%` : "-"}</span>,
                <StatusBadge key="status" value={live?.status ?? item.status} />
              ];
            })}
          />
        </div>

        <div className="min-w-0">
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

          <div className={latest.rsi >= 70 || selectedLive?.warning ? "rounded-2xl border border-yellow-300/25 bg-yellow-300/10 p-5" : "rounded-2xl border border-sky-300/20 bg-sky-300/10 p-5"}>
            <div className="flex items-center justify-between">
              <h3 className={latest.rsi >= 70 || selectedLive?.warning ? "font-semibold text-yellow-100" : "font-semibold text-sky-100"}>
                {selectedLive?.warning ? "Data Warning" : latest.rsi >= 70 ? "Warning" : "AI Note"}
              </h3>
              <StatusBadge value={latest.rsi >= 70 || selectedLive?.warning ? "Caution" : status} />
            </div>
            <p className={latest.rsi >= 70 || selectedLive?.warning ? "mt-3 text-sm leading-6 text-yellow-100/85" : "mt-3 text-sm leading-6 text-sky-100/85"}>
              {selectedLive?.warning ?? `${selectedItem.stock.ticker}はRSI ${latest.rsi.toFixed(2)}、出来高倍率 ${volumeRatio(latest).toFixed(2)}x です。MA20維持とニュース材料を確認してください。`}
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-5 shadow-xl shadow-black/20 ring-1 ring-white/5">
            <h3 className="font-semibold text-slate-50">判定根拠</h3>
            <p className="mt-2 text-sm leading-6 text-slate-300">{scoreAnalysis.summary}</p>
            <div className="mt-4 space-y-2">
              {scoreAnalysis.factors.slice(0, 5).map((factor) => (
                <ReasonRow key={factor.label} label={factor.label} points={factor.points} />
              ))}
            </div>
          </div>
        </aside>
      </section>

      <section className="grid min-w-0 gap-5 xl:grid-cols-3">
        <div className="min-w-0 xl:col-span-2">
          <SectionTitle title="AI News Analysis" note="選択中の銘柄に関係するニュースを優先表示" />
          <div className="grid gap-4 lg:grid-cols-2">
            {liveNews.slice(0, 2).map((item) => <NewsCard key={`${item.ticker}-${item.title}`} item={item} />)}
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

function ReasonRow({ label, points }: { label: string; points: number }) {
  const color = points > 0 ? "text-green-300" : points < 0 ? "text-red-300" : "text-slate-300";
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-slate-950/55 px-3 py-2 text-sm">
      <span className="text-slate-300">{label}</span>
      <span className={`font-bold ${color}`}>{points > 0 ? "+" : ""}{points}</span>
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
