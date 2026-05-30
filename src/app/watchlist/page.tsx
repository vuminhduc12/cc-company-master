"use client";

import Link from "next/link";
import { DataTable } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { resolvePriceSeries } from "@/lib/indicators";
import { pricesByTicker, watchlist } from "@/lib/mock-data";
import { statusFromScore } from "@/lib/scoring";
import { useAiJobResult } from "@/lib/use-ai-job-result";

export default function WatchlistPage() {
  const jobResult = useAiJobResult();

  return (
    <div className="space-y-5">
      <div className="rounded-3xl border border-white/10 bg-slate-900/80 p-6 shadow-xl shadow-black/25 ring-1 ring-white/5">
        <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-end">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-300">Portfolio Monitor</p>
            <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-50">Watchlist</h2>
            <p className="mt-2 text-sm text-slate-400">
              {jobResult ? `Last AI Run: ${jobResult.lastRun}` : "mock-dataを表示中"}。TickerをクリックするとStock Detailへ移動します。
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-slate-950/55 px-4 py-3 text-sm text-slate-300">
            Source: {jobResult ? "Supabase / latest AI result" : "mock-data"}
          </div>
        </div>
      </div>
      <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-end">
        <div>
          <h3 className="text-lg font-bold text-slate-50">銘柄一覧</h3>
          <p className="mt-1 text-xs text-slate-500">保有情報、現在値、AIステータスを横並びで確認できます。</p>
        </div>
      </div>
      {jobResult?.error ? (
        <div className="rounded-2xl border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-200">
          Error: {jobResult.error}
        </div>
      ) : null}
      <DataTable
        headers={["Ticker", "会社名", "市場", "保有株数", "平均取得", "現在値", "前日比", "AIスコア", "ステータス", "メモ"]}
        rows={watchlist.map((item) => {
          const hasDetail = Boolean(pricesByTicker[item.stock.ticker]);
          const live = jobResult?.stocks?.find((stockResult) => stockResult.stock.ticker === item.stock.ticker);
          const rowBasePrices = pricesByTicker[item.stock.ticker];
          const rowResolved = rowBasePrices ? resolvePriceSeries(rowBasePrices, live?.prices, live?.price) : null;
          const rowLatest = rowResolved?.prices[rowResolved.prices.length - 1];
          const currentPrice = rowLatest?.close ?? live?.price.close ?? item.currentPrice;
          const previousClose = rowResolved?.prices[rowResolved.prices.length - 2]?.close ?? (live ? currentPrice / (1 + live.price.changePercent / 100) : item.previousClose);
          const change = previousClose > 0 ? ((currentPrice - previousClose) / previousClose) * 100 : 0;
          const score = live?.aiMarketScore;
          const status = live?.status ?? (jobResult && item.stock.ticker === "RGTI" ? statusFromScore(jobResult.aiMarketScore) : item.status);
          return [
            hasDetail ? (
              <Link key="ticker" className="font-bold text-sky-300 hover:text-sky-200" href={`/stocks/${item.stock.ticker}`}>
                {item.stock.ticker}
              </Link>
            ) : (
              <span key="ticker" className="font-bold text-slate-300">{item.stock.ticker}</span>
            ),
            item.stock.companyName,
            item.stock.exchange,
            item.shares,
            `$${item.averagePrice.toFixed(2)}`,
            currentPrice ? `$${currentPrice.toFixed(2)}` : "-",
            <span key="change" className={change >= 0 ? "font-semibold text-green-400" : "font-semibold text-red-400"}>{change ? `${change.toFixed(2)}%` : "-"}</span>,
            score ?? (item.stock.ticker === "RGTI" && jobResult ? jobResult.aiMarketScore : "-"),
            <StatusBadge key="status" value={status} />,
            live ? `Data Freshness: ${live.dataFreshness}` : item.memo
          ];
        })}
      />
    </div>
  );
}
