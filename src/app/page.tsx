"use client";

import Link from "next/link";
import { useState } from "react";
import { AiEmployeeCard } from "@/components/AiEmployeeCard";
import { DataTable } from "@/components/DataTable";
import { NewsCard } from "@/components/NewsCard";
import { StatCard } from "@/components/StatCard";
import { StatusBadge } from "@/components/StatusBadge";
import { StockChart } from "@/components/StockChart";
import { latestPrice, mergeLatestPrice, volumeRatio } from "@/lib/indicators";
import { aiTasks, news, prices, pricesByTicker, report, watchlist } from "@/lib/mock-data";
import { scoreStock, statusFromScore } from "@/lib/scoring";
import { useAiJobResult } from "@/lib/use-ai-job-result";

export default function DashboardPage() {
  const [selectedTicker, setSelectedTicker] = useState("RGTI");
  const jobResult = useAiJobResult();
  const baseLatest = latestPrice(prices);
  const selectedItem = watchlist.find((item) => item.stock.ticker === selectedTicker) ?? watchlist[0];
  const selectedLive = jobResult?.stocks?.find((stockResult) => stockResult.stock.ticker === selectedItem.stock.ticker);
  const selectedBasePrices = pricesByTicker[selectedItem.stock.ticker] ?? prices;
  const chartPrices = selectedLive?.prices?.length ? selectedLive.prices : mergeLatestPrice(selectedBasePrices, selectedLive?.price ?? (selectedItem.stock.ticker === "RGTI" ? jobResult?.price : null));
  const latest = chartPrices[chartPrices.length - 1] ?? baseLatest;
  const selectedNews = selectedLive?.news?.length ? selectedLive.news : news.filter((item) => item.ticker === selectedItem.stock.ticker);
  const liveNews = selectedNews.length > 0 ? selectedNews : news;
  const score = selectedLive?.aiMarketScore ?? (selectedItem.stock.ticker === "RGTI" && jobResult ? jobResult.aiMarketScore : scoreStock(latest, liveNews));
  const status = selectedLive?.status ?? statusFromScore(score);
  const liveStatuses = watchlist.map((item) => jobResult?.stocks?.find((stockResult) => stockResult.stock.ticker === item.stock.ticker)?.status ?? item.status);
  const bullish = liveStatuses.filter((itemStatus) => itemStatus === "Strong Buy" || itemStatus === "Buy").length;
  const caution = liveStatuses.filter((itemStatus) => itemStatus === "Caution").length;
  const danger = liveStatuses.filter((itemStatus) => itemStatus === "Sell").length;
  const liveTasks = jobResult?.tasks ?? aiTasks;
  const liveReport = jobResult?.report ?? report;

  return (
    <div className="space-y-6">
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

      <section className="grid gap-5 xl:grid-cols-[340px_1fr_360px]">
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-slate-50">Watchlist</h2>
          <DataTable
            headers={["Ticker", "Price", "Chg", "Status"]}
            rows={watchlist.map((item) => {
              const live = jobResult?.stocks?.find((stockResult) => stockResult.stock.ticker === item.stock.ticker);
              const currentPrice = live?.price.close ?? item.currentPrice;
              const previousClose = live ? currentPrice / (1 + live.price.changePercent / 100) : item.previousClose;
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

        <StockChart prices={chartPrices} ticker={selectedItem.stock.ticker} />

        <aside className="space-y-4">
          <div className="rounded-2xl border border-sky-300/20 bg-slate-900/80 p-5 shadow-xl shadow-black/25">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-400">{selectedItem.stock.ticker} / {selectedItem.stock.companyName}</p>
                <p className="mt-2 text-4xl font-bold text-slate-50">${latest.close.toFixed(2)}</p>
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
        </aside>
      </section>

      <section className="grid gap-5 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <h2 className="mb-4 text-lg font-semibold text-slate-50">AI News Analysis</h2>
          <div className="grid gap-4 lg:grid-cols-2">
            {liveNews.slice(0, 2).map((item) => <NewsCard key={`${item.ticker}-${item.title}`} item={item} />)}
          </div>
        </div>
        <div>
          <h2 className="mb-4 text-lg font-semibold text-slate-50">Daily Report Summary</h2>
          <div className="rounded-2xl border border-white/10 bg-slate-900/75 p-5 shadow-lg shadow-black/20">
            <p className="text-xs text-slate-400">{liveReport.date}</p>
            <p className="mt-3 whitespace-pre-line text-sm leading-6 text-slate-200">{selectedLive?.report.decision ?? liveReport.decision}</p>
            <p className="mt-3 whitespace-pre-line text-sm leading-6 text-slate-400">{selectedLive?.report.tomorrow ?? liveReport.tomorrow}</p>
          </div>
        </div>
      </section>

      <section>
        <h2 className="mb-4 text-lg font-semibold text-slate-50">AI Employees Task Status</h2>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          {liveTasks.map((task) => <AiEmployeeCard key={task.name} task={task} />)}
        </div>
      </section>
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
