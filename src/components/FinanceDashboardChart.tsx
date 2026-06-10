"use client";

import { useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { DailyPrice } from "@/types";

export type IntradayPoint = {
  time: string;
  price: number;
  session: "regular" | "extended";
};

const ranges = [
  { label: "1日", days: 1 },
  { label: "5日", days: 5 },
  { label: "1か月", days: 31 },
  { label: "6か月", days: 186 },
  { label: "年初来", days: "ytd" },
  { label: "1年", days: 366 },
  { label: "5年", days: 366 * 5 },
  { label: "最大", days: null }
] as const;

type RangeLabel = (typeof ranges)[number]["label"];

export function FinanceDashboardChart({
  prices,
  ticker,
  intraday = [],
  previousClose,
  extendedPrice
}: {
  prices: DailyPrice[];
  ticker: string;
  intraday?: IntradayPoint[];
  previousClose?: number | null;
  extendedPrice?: number | null;
}) {
  const [rangeLabel, setRangeLabel] = useState<RangeLabel>("1日");
  const chartData = useMemo(() => {
    if (rangeLabel === "1日" && intraday.length >= 2) {
      return intraday.map((point) => ({
        label: formatTime(point.time),
        value: point.price,
        session: point.session
      }));
    }

    const visiblePrices = filterDailyPrices(prices, rangeLabel);
    const withExtended = extendedPrice && visiblePrices.length > 0
      ? [...visiblePrices, { ...visiblePrices[visiblePrices.length - 1], date: "時間外", close: extendedPrice }]
      : visiblePrices;

    return withExtended.map((price) => ({
      label: price.date === "時間外" ? "時間外" : price.date.slice(5),
      value: price.close,
      session: price.date === "時間外" ? "extended" : "regular"
    }));
  }, [extendedPrice, intraday, prices, rangeLabel]);

  const firstValue = chartData[0]?.value;
  const lastValue = chartData[chartData.length - 1]?.value;
  const baseline = rangeLabel === "1日" ? previousClose : firstValue;
  const changePercent = baseline && lastValue ? ((lastValue - baseline) / baseline) * 100 : 0;
  const isUp = changePercent >= 0;
  const strokeColor = isUp ? "#00c805" : "#ff3b30";
  const accentGlow = isUp ? "shadow-green-900/10" : "shadow-red-900/10";
  const rangeLow = chartData.reduce((min, point) => Math.min(min, point.value), Number.POSITIVE_INFINITY);
  const rangeHigh = chartData.reduce((max, point) => Math.max(max, point.value), Number.NEGATIVE_INFINITY);

  return (
    <div className={`max-w-full min-w-0 overflow-x-hidden rounded-2xl border border-slate-200 bg-white shadow-xl ${accentGlow}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 px-4 pt-4 sm:px-5 sm:pt-5">
          <p className="text-sm font-bold text-slate-950">{ticker} Advanced Chart</p>
          <p className="mt-1 text-xs font-medium text-slate-500">
            {rangeLabel === "1日" && intraday.length >= 2 ? "通常取引と時間外を含む1分足" : "日足履歴を表示"}
          </p>
        </div>
        <div className={isUp ? "px-4 pt-0 text-left text-green-700 sm:px-5 sm:pt-5 sm:text-right" : "px-4 pt-0 text-left text-red-700 sm:px-5 sm:pt-5 sm:text-right"}>
          <p className="text-xs font-semibold text-slate-500">表示期間</p>
          <p className="text-xl font-black tabular-nums">{changePercent >= 0 ? "+" : ""}{changePercent.toFixed(2)}%</p>
        </div>
      </div>

      <div className="mt-4 flex gap-1 overflow-x-auto border-y border-slate-100 px-3 py-2 [-webkit-overflow-scrolling:touch] sm:px-5">
        {ranges.map((range) => (
          <button
            key={range.label}
            className={range.label === rangeLabel
              ? "whitespace-nowrap rounded-full bg-[#6f2da8] px-3 py-1.5 text-xs font-black text-white shadow-sm"
              : "whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-bold text-slate-500 hover:bg-slate-100 hover:text-slate-900"}
            onClick={() => setRangeLabel(range.label)}
          >
            {range.label}
          </button>
        ))}
      </div>

      <div className="grid gap-2 border-b border-slate-100 px-4 py-3 text-xs sm:grid-cols-3 sm:px-5">
        <ChartStat label="現在" value={lastValue ? `$${lastValue.toFixed(2)}` : "-"} />
        <ChartStat label="レンジ安値" value={Number.isFinite(rangeLow) ? `$${rangeLow.toFixed(2)}` : "-"} />
        <ChartStat label="レンジ高値" value={Number.isFinite(rangeHigh) ? `$${rangeHigh.toFixed(2)}` : "-"} />
      </div>

      <div className="h-[310px] max-w-full min-w-0 overflow-x-hidden bg-[radial-gradient(circle_at_20%_0%,rgba(111,45,168,0.12),transparent_34%),linear-gradient(180deg,#111827,#0b1120)] p-2 sm:h-[390px] sm:p-4">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 14, right: 14, left: -8, bottom: 6 }}>
            <defs>
              <linearGradient id={`finance-fill-${ticker}`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={strokeColor} stopOpacity={0.34} />
                <stop offset="45%" stopColor={strokeColor} stopOpacity={0.10} />
                <stop offset="100%" stopColor={strokeColor} stopOpacity={0.01} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="rgba(148,163,184,0.14)" vertical={false} />
            <XAxis dataKey="label" tick={{ fill: "#94a3b8", fontSize: 11, fontWeight: 600 }} minTickGap={28} tickLine={false} axisLine={{ stroke: "rgba(148,163,184,0.22)" }} />
            <YAxis orientation="right" tick={{ fill: "#94a3b8", fontSize: 11, fontWeight: 600 }} domain={["dataMin - 1", "dataMax + 1"]} tickLine={false} axisLine={false} width={54} />
            {previousClose ? <ReferenceLine y={previousClose} stroke="rgba(203,213,225,0.68)" strokeDasharray="4 6" /> : null}
            <Tooltip
              cursor={{ stroke: "rgba(255,255,255,0.28)", strokeDasharray: "4 4" }}
              contentStyle={{ background: "#0f172a", border: "1px solid rgba(148,163,184,0.30)", borderRadius: 14, color: "#f8fafc", boxShadow: "0 18px 36px rgba(0,0,0,0.35)" }}
              formatter={(value) => [`$${Number(value).toFixed(2)}`, "価格"]}
              labelFormatter={(label) => `${label}`}
            />
            <Area type="monotone" dataKey="value" stroke={strokeColor} strokeWidth={3.2} fill={`url(#finance-fill-${ticker})`} dot={false} activeDot={{ r: 5, fill: strokeColor, stroke: "#0f172a", strokeWidth: 2 }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function ChartStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2">
      <p className="font-bold text-slate-400">{label}</p>
      <p className="mt-1 font-black text-slate-950 tabular-nums">{value}</p>
    </div>
  );
}

function filterDailyPrices(prices: DailyPrice[], rangeLabel: RangeLabel) {
  const currentRange = ranges.find((range) => range.label === rangeLabel) ?? ranges[2];
  if (currentRange.days === null) return prices;
  const latest = prices[prices.length - 1];
  if (!latest) return prices;

  if (currentRange.days === "ytd") {
    const latestYear = latest.date.slice(0, 4);
    return prices.filter((price) => price.date.startsWith(latestYear));
  }

  const latestTime = new Date(`${latest.date}T00:00:00`).getTime();
  const startTime = latestTime - currentRange.days * 24 * 60 * 60 * 1000;
  return prices.filter((price) => new Date(`${price.date}T00:00:00`).getTime() >= startTime);
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}
