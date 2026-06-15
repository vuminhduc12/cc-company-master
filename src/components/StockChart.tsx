"use client";

import { useMemo, useState } from "react";
import { Area, Bar, BarChart, CartesianGrid, ComposedChart, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { DailyPrice } from "@/types";

const ranges = [
  { label: "1週", days: 7 },
  { label: "1ヶ月", days: 31 },
  { label: "3ヶ月", days: 93 },
  { label: "1年", days: 366 },
  { label: "5年", days: 366 * 5 },
  { label: "最大", days: null }
] as const;

export function StockChart({ prices, ticker = "RGTI" }: { prices: DailyPrice[]; ticker?: string }) {
  const [rangeLabel, setRangeLabel] = useState<(typeof ranges)[number]["label"]>("1ヶ月");
  const visiblePrices = useMemo(() => {
    const currentRange = ranges.find((range) => range.label === rangeLabel) ?? ranges[1];
    if (!currentRange.days) return prices;
    const latest = prices[prices.length - 1];
    if (!latest) return prices;
    const latestTime = new Date(`${latest.date}T00:00:00`).getTime();
    const startTime = latestTime - currentRange.days * 24 * 60 * 60 * 1000;
    return prices.filter((price) => new Date(`${price.date}T00:00:00`).getTime() >= startTime);
  }, [prices, rangeLabel]);
  const latest = visiblePrices[visiblePrices.length - 1];
  const first = visiblePrices[0];
  const rangeChange = latest && first && first.close > 0 ? ((latest.close - first.close) / first.close) * 100 : 0;
  const totalVolume = visiblePrices.reduce((sum, price) => sum + price.volume, 0);
  const isUp = rangeChange >= 0;
  const priceColor = isUp ? "#16a34a" : "#dc2626";
  const rangeHigh = visiblePrices.reduce((max, price) => Math.max(max, price.high), Number.NEGATIVE_INFINITY);
  const rangeLow = visiblePrices.reduce((min, price) => Math.min(min, price.low), Number.POSITIVE_INFINITY);

  return (
    <div className="max-w-full min-w-0 overflow-x-hidden rounded-xl border border-white/10 bg-neutral-950 shadow-2xl shadow-black/30 ring-1 ring-white/5">
      <div className="flex flex-col justify-between gap-4 border-b border-white/10 bg-[linear-gradient(180deg,rgba(23,23,23,0.96),rgba(5,5,5,0.92))] p-4 sm:p-5 xl:flex-row xl:items-start">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-teal-200">Advanced Chart</p>
          <h2 className="mt-1 text-xl font-black text-slate-50">{ticker}</h2>
          <p className="mt-1 text-sm text-slate-400">価格 / 移動平均 / 出来高 / RSI</p>
        </div>
        <div className="flex gap-1 overflow-x-auto rounded-xl border border-white/10 bg-black/45 p-1 [-webkit-overflow-scrolling:touch]">
          {ranges.map((range) => (
            <button
              key={range.label}
              className={range.label === rangeLabel ? "whitespace-nowrap rounded-lg bg-teal-300 px-3 py-1.5 text-xs font-black text-neutral-950 shadow-lg shadow-teal-950/30" : "whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-bold text-slate-400 hover:bg-white/10 hover:text-slate-100"}
              onClick={() => setRangeLabel(range.label)}
            >
              {range.label}
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-3 p-4 sm:grid-cols-4 sm:p-5">
        <ChartMetric label="現在値" value={latest ? `$${latest.close.toFixed(2)}` : "-"} tone={isUp ? "up" : "down"} />
        <ChartMetric label="期間騰落率" value={`${rangeChange >= 0 ? "+" : ""}${rangeChange.toFixed(2)}%`} tone={isUp ? "up" : "down"} />
        <ChartMetric label="レンジ" value={Number.isFinite(rangeLow) && Number.isFinite(rangeHigh) ? `$${rangeLow.toFixed(2)} - $${rangeHigh.toFixed(2)}` : "-"} />
        <ChartMetric label="出来高合計" value={`${Math.round(totalVolume / 1000000).toLocaleString()}M`} tone="purple" />
      </div>
      <div className="px-3 pb-4 sm:px-5">
        <div className="h-[320px] max-w-full min-w-0 overflow-x-hidden rounded-xl border border-white/10 bg-[linear-gradient(180deg,#101010,#050505)] p-2 sm:h-[410px] sm:p-4">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={visiblePrices} margin={{ top: 12, right: 8, left: -8, bottom: 4 }}>
              <defs>
                <linearGradient id={`stock-fill-${ticker}`} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor={priceColor} stopOpacity={0.32} />
                  <stop offset="48%" stopColor={priceColor} stopOpacity={0.10} />
                  <stop offset="100%" stopColor={priceColor} stopOpacity={0.01} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="rgba(148,163,184,0.13)" vertical={false} />
              <XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 11, fontWeight: 600 }} tickFormatter={formatDateTick} minTickGap={30} tickLine={false} axisLine={{ stroke: "rgba(148,163,184,0.20)" }} />
              <YAxis orientation="right" tick={{ fill: "#94a3b8", fontSize: 11, fontWeight: 600 }} domain={["dataMin - 2", "dataMax + 2"]} width={54} tickLine={false} axisLine={false} />
              {first ? <ReferenceLine y={first.close} stroke="rgba(203,213,225,0.50)" strokeDasharray="4 6" /> : null}
              <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(148,163,184,0.30)", borderRadius: 14, color: "#f8fafc", boxShadow: "0 18px 36px rgba(0,0,0,0.35)" }} cursor={{ stroke: "rgba(255,255,255,0.28)", strokeDasharray: "4 4" }} />
              <Area type="monotone" dataKey="close" name="Close" stroke={priceColor} strokeWidth={3.2} fill={`url(#stock-fill-${ticker})`} dot={false} activeDot={{ r: 5, fill: priceColor, stroke: "#0f172a", strokeWidth: 2 }} />
              <Line type="monotone" dataKey="ma20" name="MA20" stroke="#f7b955" strokeWidth={1.8} dot={false} strokeDasharray="5 4" />
              <Line type="monotone" dataKey="ma50" name="MA50" stroke="#2dd4bf" strokeWidth={1.8} dot={false} strokeDasharray="5 4" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="grid min-w-0 gap-4 px-3 pb-4 sm:px-5 sm:pb-5 lg:grid-cols-[1fr_0.7fr]">
        <div className="max-w-full min-w-0 overflow-x-hidden rounded-xl border border-white/10 bg-black/45 p-3 sm:p-4">
          <p className="mb-3 text-sm font-bold text-slate-100">Volume</p>
          <ResponsiveContainer width="100%" height={170}>
            <BarChart data={visiblePrices}>
              <CartesianGrid stroke="rgba(148,163,184,0.13)" vertical={false} />
              <XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 10 }} tickFormatter={formatDateTick} minTickGap={30} tickLine={false} axisLine={false} />
              <YAxis tick={{ fill: "#94a3b8", fontSize: 10 }} tickFormatter={(value) => `${Math.round(Number(value) / 1000000)}M`} width={42} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(148,163,184,0.30)", borderRadius: 14, color: "#f8fafc" }} formatter={(value) => `${Math.round(Number(value) / 1000000)}M`} />
              <Bar dataKey="volume" name="Volume" fill="#14b8a6" opacity={0.82} radius={[5, 5, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="max-w-full min-w-0 overflow-x-hidden rounded-xl border border-white/10 bg-black/45 p-3 sm:p-4">
          <p className="mb-3 text-sm font-bold text-slate-100">RSI</p>
          <ResponsiveContainer width="100%" height={170}>
            <LineChart data={visiblePrices}>
              <CartesianGrid stroke="rgba(148,163,184,0.13)" vertical={false} />
              <XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 10 }} tickFormatter={formatDateTick} minTickGap={30} tickLine={false} axisLine={false} />
              <YAxis tick={{ fill: "#94a3b8", fontSize: 10 }} domain={[20, 85]} width={34} tickLine={false} axisLine={false} />
              <ReferenceLine y={70} stroke="rgba(248,113,113,0.65)" strokeDasharray="4 5" />
              <ReferenceLine y={30} stroke="rgba(74,222,128,0.65)" strokeDasharray="4 5" />
              <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(148,163,184,0.30)", borderRadius: 14, color: "#f8fafc" }} />
              <Line type="monotone" dataKey="rsi" name="RSI" stroke="#facc15" strokeWidth={2.4} dot={false} activeDot={{ r: 4, fill: "#facc15", stroke: "#0f172a", strokeWidth: 2 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

function formatDateTick(value: string) {
  return value.slice(5);
}

function ChartMetric({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "up" | "down" | "blue" | "purple" }) {
  const color = {
    default: "text-slate-50",
    up: "text-green-300",
    down: "text-red-300",
    blue: "text-sky-300",
    purple: "text-teal-200"
  }[tone];

  return (
    <div className="rounded-xl border border-white/10 bg-black/38 p-3">
      <p className="text-xs font-bold text-slate-500">{label}</p>
      <p className={`mt-1 text-sm font-black tabular-nums ${color}`}>{value}</p>
    </div>
  );
}
