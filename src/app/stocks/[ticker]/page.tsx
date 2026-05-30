"use client";

import { use } from "react";
import { notFound } from "next/navigation";
import { DataTable } from "@/components/DataTable";
import { StockChart } from "@/components/StockChart";
import { mergeLatestPrice } from "@/lib/indicators";
import { getPricesForTicker, watchlist } from "@/lib/mock-data";
import { useAiJobResult } from "@/lib/use-ai-job-result";

export default function StockDetailPage({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = use(params);
  const item = watchlist.find((row) => row.stock.ticker === ticker.toUpperCase());
  const jobResult = useAiJobResult();
  if (!item) notFound();

  const tickerPrices = getPricesForTicker(item.stock.ticker);
  if (!tickerPrices) notFound();

  const live = jobResult?.stocks?.find((stockResult) => stockResult.stock.ticker === item.stock.ticker);
  const livePrice = live?.price ?? (item.stock.ticker === "RGTI" ? jobResult?.price : null);
  const livePrices = live?.prices?.length ? live.prices : null;
  const mergedPrices = livePrices ?? mergeLatestPrice(tickerPrices, livePrice);
  const chartPrices = mergedPrices;
  const tablePrices = mergedPrices.slice().reverse();
  const latest = mergedPrices[mergedPrices.length - 1];

  return (
    <div className="space-y-4">
      <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-end">
        <div>
          <h2 className="text-2xl font-bold text-slate-50">{item.stock.ticker}</h2>
          <p className="text-sm text-slate-400">{item.stock.companyName} / {item.stock.exchange}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-slate-900/75 px-4 py-3 text-sm text-slate-300">
          Source: {livePrices ? "API full daily history + AI analysis" : live ? "Supabase / latest AI result + local history" : item.stock.ticker === "RGTI" ? "Excel history" : "MVP dummy data"}
        </div>
      </div>
      {live?.error || jobResult?.error ? (
        <div className="rounded-2xl border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-200">
          Error: {live?.error ?? jobResult?.error}
        </div>
      ) : null}
      {live?.warning ? (
        <div className="rounded-2xl border border-yellow-300/30 bg-yellow-300/10 p-4 text-sm leading-6 text-yellow-100">
          Warning: {live.warning}
        </div>
      ) : null}

      <section className="grid gap-4 md:grid-cols-4">
        <InsightCard label="最新終値" value={`$${latest.close.toFixed(2)}`} />
        <InsightCard label="前日比" value={`${latest.changePercent.toFixed(2)}%`} tone={latest.changePercent >= 0 ? "up" : "down"} />
        <InsightCard label="RSI" value={latest.rsi.toFixed(2)} tone={latest.rsi >= 70 ? "warn" : latest.rsi >= 55 ? "up" : "default"} />
        <InsightCard label="日次データ件数" value={`${mergedPrices.length}件`} tone="blue" />
      </section>

      <StockChart prices={chartPrices} ticker={item.stock.ticker} />
      <DataTable
        headers={["日付", "始値", "高値", "安値", "終値", "出来高", "前日比%", "出来高倍率", "RSI", "MACD", "MACD方向", "MA5", "MA20", "MA50", "スコア", "判定"]}
        rows={tablePrices.map((price) => [
          price.date,
          `$${price.open.toFixed(2)}`,
          `$${price.high.toFixed(2)}`,
          `$${price.low.toFixed(2)}`,
          `$${price.close.toFixed(2)}`,
          `${Math.round(price.volume / 1000000)}M`,
          <ChangeCell key="change" value={price.changePercent} />,
          <VolumeRatioCell key="volume-ratio" value={price.volumeRatio} />,
          <RsiCell key="rsi" value={price.rsi} />,
          price.macd.toFixed(2),
          <DirectionCell key="macd-direction" value={price.macdDirection} />,
          `$${price.ma5.toFixed(2)}`,
          `$${price.ma20.toFixed(2)}`,
          `$${price.ma50.toFixed(2)}`,
          <ScoreCell key="score" value={price.score} />,
          <PatternCell key="pattern" pattern={price.pattern} score={price.score} high20Breakout={price.high20Breakout} />
        ])}
      />
    </div>
  );
}

function InsightCard({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "up" | "down" | "warn" | "blue" }) {
  const color = {
    default: "text-slate-50",
    up: "text-sky-300",
    down: "text-red-300",
    warn: "text-yellow-300",
    blue: "text-sky-300"
  }[tone];

  return (
    <div className="rounded-2xl border border-white/10 bg-slate-900/75 p-4 shadow-lg shadow-black/20">
      <p className="text-sm text-slate-400">{label}</p>
      <p className={`mt-2 text-2xl font-bold ${color}`}>{value}</p>
    </div>
  );
}

function Pill({ children, className }: { children: React.ReactNode; className: string }) {
  return <span className={`inline-flex min-w-20 justify-center rounded-full border px-2.5 py-1 text-xs font-bold ${className}`}>{children}</span>;
}

function ChangeCell({ value }: { value: number }) {
  if (value > 0) return <Pill className="border-sky-300/40 bg-sky-300/15 text-sky-200">+{value.toFixed(2)}%</Pill>;
  if (value < 0) return <Pill className="border-red-400/40 bg-red-400/15 text-red-300">{value.toFixed(2)}%</Pill>;
  return <Pill className="border-slate-400/30 bg-slate-400/10 text-slate-300">0.00%</Pill>;
}

function VolumeRatioCell({ value }: { value: number }) {
  if (value >= 1.5) return <Pill className="border-sky-300/40 bg-sky-300/15 text-sky-200">{value.toFixed(2)}x</Pill>;
  if (value >= 1.2) return <Pill className="border-green-400/40 bg-green-400/15 text-green-300">{value.toFixed(2)}x</Pill>;
  if (value > 0) return <Pill className="border-slate-400/30 bg-slate-400/10 text-slate-300">{value.toFixed(2)}x</Pill>;
  return <span className="text-slate-500">-</span>;
}

function RsiCell({ value }: { value: number }) {
  if (value >= 70) return <Pill className="border-yellow-300/40 bg-yellow-300/15 text-yellow-200">{value.toFixed(2)}</Pill>;
  if (value >= 55) return <Pill className="border-sky-300/40 bg-sky-300/15 text-sky-200">{value.toFixed(2)}</Pill>;
  if (value > 0) return <Pill className="border-slate-400/30 bg-slate-400/10 text-slate-300">{value.toFixed(2)}</Pill>;
  return <span className="text-slate-500">-</span>;
}

function DirectionCell({ value }: { value: "上昇" | "低下" }) {
  return value === "上昇"
    ? <Pill className="border-sky-300/40 bg-sky-300/15 text-sky-200">上昇</Pill>
    : <Pill className="border-red-400/40 bg-red-400/15 text-red-300">低下</Pill>;
}

function ScoreCell({ value }: { value: number }) {
  if (value >= 8) return <Pill className="border-green-400/40 bg-green-400/15 text-green-300">{value}</Pill>;
  if (value >= 6) return <Pill className="border-sky-300/40 bg-sky-300/15 text-sky-200">{value}</Pill>;
  if (value >= 4) return <Pill className="border-yellow-300/40 bg-yellow-300/15 text-yellow-200">{value}</Pill>;
  return <Pill className="border-slate-400/30 bg-slate-400/10 text-slate-300">{value}</Pill>;
}

function PatternCell({ pattern, score, high20Breakout }: { pattern: string; score: number; high20Breakout: string }) {
  const label = pattern || high20Breakout || (score >= 6 ? "類似上昇候補" : "通常");
  if (score >= 8 || pattern.includes("強気") || high20Breakout) {
    return <Pill className="border-green-400/40 bg-green-400/15 text-green-300">{label}</Pill>;
  }
  if (score >= 6 || pattern.includes("候補")) {
    return <Pill className="border-sky-300/40 bg-sky-300/15 text-sky-200">{label}</Pill>;
  }
  if (score >= 4) {
    return <Pill className="border-yellow-300/40 bg-yellow-300/15 text-yellow-200">{label}</Pill>;
  }
  return <span className="text-slate-500">{label}</span>;
}
