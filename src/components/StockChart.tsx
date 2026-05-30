"use client";

import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
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

  return (
    <div className="space-y-4 rounded-2xl border border-white/10 bg-slate-900/75 p-5 shadow-xl shadow-black/25">
      <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-start">
        <div>
          <h2 className="text-lg font-semibold text-slate-50">{ticker} Main Chart</h2>
          <p className="text-sm text-slate-400">価格 / 出来高 / RSI</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {ranges.map((range) => (
            <button
              key={range.label}
              className={range.label === rangeLabel ? "rounded-full bg-sky-400 px-3 py-1.5 text-xs font-bold text-slate-950" : "rounded-full border border-white/10 bg-slate-950/60 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-800"}
              onClick={() => setRangeLabel(range.label)}
            >
              {range.label}
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <ChartMetric label="表示期間" value={rangeLabel} />
        <ChartMetric label="期間騰落率" value={`${rangeChange >= 0 ? "+" : ""}${rangeChange.toFixed(2)}%`} tone={rangeChange >= 0 ? "up" : "down"} />
        <ChartMetric label="期間出来高合計" value={`${Math.round(totalVolume / 1000000).toLocaleString()}M`} tone="blue" />
      </div>
      <ResponsiveContainer width="100%" height={360}>
        <LineChart data={visiblePrices}>
          <CartesianGrid stroke="#1f2937" vertical={false} />
          <XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 11 }} />
          <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} domain={["dataMin - 2", "dataMax + 2"]} />
          <Tooltip contentStyle={{ background: "#020617", border: "1px solid #334155", borderRadius: 12, color: "#f8fafc" }} />
          <Line type="monotone" dataKey="close" name="Close" stroke="#38bdf8" strokeWidth={3} dot={false} />
          <Line type="monotone" dataKey="ma20" name="MA20" stroke="#22c55e" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="ma50" name="MA50" stroke="#f59e0b" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
      <div className="grid gap-4 lg:grid-cols-[1fr_0.7fr]">
        <div className="rounded-xl bg-slate-950/50 p-4">
          <p className="mb-3 text-sm font-semibold text-slate-200">Volume</p>
          <ResponsiveContainer width="100%" height={170}>
            <BarChart data={visiblePrices}>
              <CartesianGrid stroke="#1f2937" vertical={false} />
              <XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 10 }} />
              <YAxis tick={{ fill: "#94a3b8", fontSize: 10 }} tickFormatter={(value) => `${Math.round(Number(value) / 1000000)}M`} />
              <Tooltip contentStyle={{ background: "#020617", border: "1px solid #334155", borderRadius: 12, color: "#f8fafc" }} formatter={(value) => `${Math.round(Number(value) / 1000000)}M`} />
              <Bar dataKey="volume" name="Volume" fill="#38bdf8" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="rounded-xl bg-slate-950/50 p-4">
          <p className="mb-3 text-sm font-semibold text-slate-200">RSI</p>
          <ResponsiveContainer width="100%" height={170}>
            <LineChart data={visiblePrices}>
              <CartesianGrid stroke="#1f2937" vertical={false} />
              <XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 10 }} />
              <YAxis tick={{ fill: "#94a3b8", fontSize: 10 }} domain={[30, 80]} />
              <Tooltip contentStyle={{ background: "#020617", border: "1px solid #334155", borderRadius: 12, color: "#f8fafc" }} />
              <Line type="monotone" dataKey="rsi" name="RSI" stroke="#facc15" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

function ChartMetric({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "up" | "down" | "blue" }) {
  const color = {
    default: "text-slate-50",
    up: "text-sky-300",
    down: "text-red-300",
    blue: "text-sky-300"
  }[tone];

  return (
    <div className="rounded-xl bg-slate-950/50 p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`mt-1 text-sm font-bold ${color}`}>{value}</p>
    </div>
  );
}
