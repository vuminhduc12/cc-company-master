"use client";

import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { TradingCandlestickChart } from "@/components/TradingCandlestickChart";
import type { TradingIntradayCandle, TradingIntradayPoint } from "@/components/TradingCandlestickChart";
import type { DailyPrice } from "@/types";

const rsiRanges = [
  { label: "1D", days: null, bars: 1 },
  { label: "5D", days: null, bars: 5 },
  { label: "1M", days: 31 },
  { label: "3M", days: 93 },
  { label: "1Y", days: 366 },
  { label: "ALL", days: null }
] as const;

type StockChartProps = {
  prices: DailyPrice[];
  ticker?: string;
  intraday?: TradingIntradayPoint[];
  intradayCandles?: TradingIntradayCandle[];
  previousClose?: number | null;
  extendedPrice?: number | null;
};

export function StockChart({ prices, ticker = "RGTI", intraday = [], intradayCandles = [], previousClose, extendedPrice }: StockChartProps) {
  const [rsiRangeLabel, setRsiRangeLabel] = useState<(typeof rsiRanges)[number]["label"]>("3M");
  const visibleRsi = useMemo(() => filterDailyPrices(prices, rsiRangeLabel), [prices, rsiRangeLabel]);
  const hasLiveCandles = intradayCandles.length >= 2;

  return (
    <div className="space-y-4">
      <TradingCandlestickChart
        prices={prices}
        ticker={ticker}
        intraday={intraday}
        intradayCandles={intradayCandles}
        defaultRange={hasLiveCandles ? "1m" : "3M"}
        height={500}
        previousClose={previousClose}
        extendedPrice={extendedPrice}
        subtitle={hasLiveCandles ? "Realtime 1m OHLC / VWAP" : "MA20 / MA50 / Volume"}
      />

      <section className="max-w-full min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-neutral-950 shadow-xl shadow-black/25 ring-1 ring-white/5">
        <div className="flex flex-col gap-3 border-b border-white/10 bg-[linear-gradient(180deg,rgba(23,23,23,0.96),rgba(5,5,5,0.92))] p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-amber-200">Momentum</p>
            <h3 className="mt-1 text-lg font-black text-white">RSI Oscillator</h3>
          </div>
          <div className="flex gap-1 overflow-x-auto rounded-xl border border-white/10 bg-black/45 p-1 [-webkit-overflow-scrolling:touch]">
            {rsiRanges.map((range) => (
              <button
                key={range.label}
                className={range.label === rsiRangeLabel ? "whitespace-nowrap rounded-lg bg-amber-300 px-3 py-1.5 text-xs font-black text-neutral-950 shadow-lg shadow-amber-950/30" : "whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-bold text-slate-400 hover:bg-white/10 hover:text-slate-100"}
                onClick={() => setRsiRangeLabel(range.label)}
                type="button"
              >
                {range.label}
              </button>
            ))}
          </div>
        </div>

        <div className="h-[210px] p-3 sm:p-4">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={visibleRsi} margin={{ top: 10, right: 16, left: -10, bottom: 4 }}>
              <CartesianGrid stroke="rgba(148,163,184,0.13)" vertical={false} />
              <XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 10, fontWeight: 700 }} tickFormatter={formatDateTick} minTickGap={30} tickLine={false} axisLine={false} />
              <YAxis orientation="right" tick={{ fill: "#94a3b8", fontSize: 10, fontWeight: 700 }} domain={[20, 85]} width={38} tickLine={false} axisLine={false} />
              <ReferenceLine y={70} stroke="rgba(248,113,113,0.70)" strokeDasharray="4 5" />
              <ReferenceLine y={30} stroke="rgba(74,222,128,0.70)" strokeDasharray="4 5" />
              <Tooltip contentStyle={{ background: "#020617", border: "1px solid rgba(148,163,184,0.30)", borderRadius: 12, color: "#f8fafc", boxShadow: "0 18px 36px rgba(0,0,0,0.35)" }} formatter={(value) => [Number(value).toFixed(2), "RSI"]} />
              <Line type="monotone" dataKey="rsi" name="RSI" stroke="#facc15" strokeWidth={2.6} dot={false} activeDot={{ r: 4, fill: "#facc15", stroke: "#020617", strokeWidth: 2 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>
    </div>
  );
}

function filterDailyPrices(prices: DailyPrice[], rangeLabel: (typeof rsiRanges)[number]["label"]) {
  const currentRange = rsiRanges.find((range) => range.label === rangeLabel) ?? rsiRanges[1];
  if ("bars" in currentRange && currentRange.bars) return prices.slice(-currentRange.bars);
  if (!currentRange.days) return prices;
  const latest = prices[prices.length - 1];
  if (!latest) return prices;
  const latestTime = new Date(`${latest.date}T00:00:00`).getTime();
  const startTime = latestTime - currentRange.days * 24 * 60 * 60 * 1000;
  return prices.filter((price) => new Date(`${price.date}T00:00:00`).getTime() >= startTime);
}

function formatDateTick(value: string) {
  const [year, month, day] = value.split("-");
  if (year && month && day) return `${Number(month)}/${Number(day)}`;
  return value.slice(0, 5);
}
