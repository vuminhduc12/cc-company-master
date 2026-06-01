"use client";

import { use } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DataTable } from "@/components/DataTable";
import { SpotEntrySimulator } from "@/components/SpotEntrySimulator";
import { StockChart } from "@/components/StockChart";
import { resolvePriceSeries } from "@/lib/indicators";
import { getPricesForTicker, watchlist } from "@/lib/mock-data";
import { analyzeStock } from "@/lib/scoring";
import { useAiJobResult } from "@/lib/use-ai-job-result";
import type { DailyPrice } from "@/types";

export default function StockDetailPage({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = use(params);
  const item = watchlist.find((row) => row.stock.ticker === ticker.toUpperCase());
  const jobResult = useAiJobResult();
  if (!item) notFound();

  const tickerPrices = getPricesForTicker(item.stock.ticker);
  if (!tickerPrices) notFound();

  const live = jobResult?.stocks?.find((stockResult) => stockResult.stock.ticker === item.stock.ticker);
  const livePrice = live?.price ?? (item.stock.ticker === "RGTI" ? jobResult?.price : null);
  const resolvedPrices = resolvePriceSeries(tickerPrices, live?.prices, livePrice);
  const mergedPrices = resolvedPrices.prices;
  const chartPrices = mergedPrices;
  const tablePrices = mergedPrices.slice().reverse();
  const latest = mergedPrices[mergedPrices.length - 1];
  const tickerNews = live?.news ?? [];
  const scoreAnalysis = analyzeStock(latest, tickerNews);
  const sourceLabel = live ? resolvedPrices.source : item.stock.ticker === "RGTI" ? "Excel history" : "Local SIDU historical data";
  const detailItems = watchlist.filter((row) => Boolean(getPricesForTicker(row.stock.ticker)));

  return (
    <div className="min-w-0 space-y-5">
      <div className="rounded-3xl border border-white/10 bg-slate-900/80 p-4 shadow-xl shadow-black/25 ring-1 ring-white/5 sm:p-6">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-300">Stock Detail</p>
            <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-50 sm:text-4xl">{item.stock.ticker}</h2>
            <p className="mt-2 text-sm text-slate-400">{item.stock.companyName} / {item.stock.exchange}</p>
          </div>
          <div className="grid min-w-0 gap-2 text-left sm:grid-cols-2 sm:text-right lg:grid-cols-1">
            <div className={latest.changePercent >= 0 ? "text-sky-300" : "text-red-300"}>
              <p className="text-3xl font-black">${latest.close.toFixed(2)}</p>
              <p className="text-sm font-bold">{latest.changePercent >= 0 ? "+" : ""}{latest.changePercent.toFixed(2)}%</p>
            </div>
            <div className="break-words rounded-2xl border border-white/10 bg-slate-950/55 px-4 py-3 text-sm text-slate-300">
              Source: {sourceLabel}
            </div>
          </div>
        </div>
      </div>

      <div className="flex min-w-0 flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-slate-900/80 p-2 shadow-xl shadow-black/20 ring-1 ring-white/5">
        <span className="px-2 text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Select Stock</span>
        {detailItems.map((row) => {
          const active = row.stock.ticker === item.stock.ticker;
          return (
            <Link
              key={row.stock.ticker}
              href={`/stocks/${row.stock.ticker}`}
              className={`rounded-xl border px-4 py-2 text-sm font-bold transition ${
                active
                  ? "border-sky-300/50 bg-sky-300/15 text-sky-100 shadow-lg shadow-sky-950/30"
                  : "border-white/10 bg-white/5 text-slate-300 hover:border-sky-300/30 hover:bg-sky-300/10"
              }`}
            >
              {row.stock.ticker}
            </Link>
          );
        })}
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
      {resolvedPrices.rejectedLive ? (
        <div className="rounded-2xl border border-yellow-300/30 bg-yellow-300/10 p-4 text-sm leading-6 text-yellow-100">
          Data Warning: APIから取得した{item.stock.ticker}価格がローカル検証済み履歴と大きく異なるため、テーブルとチャートではローカル履歴を優先表示しています。
        </div>
      ) : null}

      <section className="grid gap-4 md:grid-cols-4">
        <InsightCard label="最新終値" value={`$${latest.close.toFixed(2)}`} />
        <InsightCard label="前日比" value={`${latest.changePercent.toFixed(2)}%`} tone={latest.changePercent >= 0 ? "up" : "down"} />
        <InsightCard label="RSI" value={latest.rsi.toFixed(2)} tone={latest.rsi >= 70 ? "warn" : latest.rsi >= 55 ? "up" : "default"} />
        <InsightCard label="日次データ件数" value={`${mergedPrices.length}件`} tone="blue" />
      </section>

      <div className="min-w-0">
        <StockChart prices={chartPrices} ticker={item.stock.ticker} />
      </div>

      <SpotEntrySimulator stock={item.stock} price={latest} news={tickerNews} score={scoreAnalysis.score} />

      <section className="rounded-2xl border border-white/10 bg-slate-900/80 p-4 shadow-xl shadow-black/20 ring-1 ring-white/5 sm:p-5">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
          <div>
            <h3 className="text-lg font-bold text-slate-50">AI判定根拠</h3>
            <p className="mt-2 text-sm leading-6 text-slate-300">{scoreAnalysis.summary}</p>
          </div>
          <div className="rounded-2xl border border-sky-300/25 bg-sky-300/10 px-4 py-3">
            <p className="text-xs font-semibold text-sky-200">Advanced Score</p>
            <p className="mt-1 text-3xl font-black text-sky-100">{scoreAnalysis.score}</p>
          </div>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <ReasonList title="強材料" items={scoreAnalysis.positivePoints.slice(0, 4)} />
          <ReasonList title="注意材料" items={scoreAnalysis.negativePoints.slice(0, 4)} />
        </div>
      </section>

      <section className="md:hidden">
        <div className="mb-3">
          <h3 className="text-base font-bold text-slate-50">日次データ</h3>
          <p className="mt-1 text-xs text-slate-500">スマホでは直近14営業日をカードで表示します。</p>
        </div>
        <div className="space-y-3">
          {tablePrices.slice(0, 14).map((price) => <MobileDailyCard key={price.date} price={price} />)}
        </div>
      </section>

      <div className="hidden md:block">
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
    </div>
  );
}

function ReasonList({ title, items }: { title: string; items: { label: string; points: number; detail: string }[] }) {
  return (
    <div className="rounded-xl bg-slate-950/55 p-3">
      <p className="text-sm font-bold text-slate-100">{title}</p>
      <div className="mt-3 space-y-3">
        {items.length ? items.map((item) => (
          <div key={item.label} className="border-t border-white/10 pt-3 first:border-t-0 first:pt-0">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-semibold text-slate-200">{item.label}</span>
              <span className={item.points > 0 ? "text-sm font-bold text-green-300" : "text-sm font-bold text-red-300"}>
                {item.points > 0 ? "+" : ""}{item.points}
              </span>
            </div>
            <p className="mt-1 text-xs leading-5 text-slate-500">{item.detail}</p>
          </div>
        )) : <p className="text-sm text-slate-500">該当なし</p>}
      </div>
    </div>
  );
}

function MobileDailyCard({ price }: { price: DailyPrice }) {
  const isUp = price.changePercent >= 0;

  return (
    <article className="rounded-2xl border border-white/10 bg-slate-900/82 p-4 shadow-lg shadow-black/20 ring-1 ring-white/5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-black text-slate-50">{price.date}</p>
          <p className="mt-1 text-xs text-slate-500">出来高 {Math.round(price.volume / 1000000).toLocaleString()}M</p>
        </div>
        <div className="text-right">
          <p className="text-xl font-black text-slate-50">${price.close.toFixed(2)}</p>
          <p className={isUp ? "mt-1 text-sm font-bold text-sky-300" : "mt-1 text-sm font-bold text-red-300"}>
            {isUp ? "+" : ""}{price.changePercent.toFixed(2)}%
          </p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
        <MobileMetric label="始値" value={`$${price.open.toFixed(2)}`} />
        <MobileMetric label="高値" value={`$${price.high.toFixed(2)}`} />
        <MobileMetric label="安値" value={`$${price.low.toFixed(2)}`} />
        <MobileMetric label="RSI" value={price.rsi.toFixed(2)} tone={price.rsi >= 70 ? "warn" : price.rsi >= 55 ? "up" : "default"} />
        <MobileMetric label="MA20" value={`$${price.ma20.toFixed(2)}`} />
        <MobileMetric label="出来高倍率" value={`${price.volumeRatio.toFixed(2)}x`} tone={price.volumeRatio >= 1.2 ? "up" : "default"} />
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <DirectionCell value={price.macdDirection} />
        <ScoreCell value={price.score} />
        <PatternCell pattern={price.pattern} score={price.score} high20Breakout={price.high20Breakout} />
      </div>
    </article>
  );
}

function MobileMetric({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "up" | "warn" }) {
  const color = {
    default: "text-slate-100",
    up: "text-sky-300",
    warn: "text-yellow-300"
  }[tone];

  return (
    <div className="rounded-xl bg-slate-950/55 p-3">
      <p className="text-[11px] font-semibold text-slate-500">{label}</p>
      <p className={`mt-1 font-bold tabular-nums ${color}`}>{value}</p>
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
    <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-4 shadow-xl shadow-black/20 ring-1 ring-white/5">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</p>
      <p className={`mt-3 text-2xl font-black ${color}`}>{value}</p>
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
