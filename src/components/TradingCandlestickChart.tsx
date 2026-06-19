"use client";

import { useMemo, useState } from "react";
import type { DailyPrice } from "@/types";

type CandleRange = {
  label: string;
  days: number | null | "ytd";
  bars?: number;
  intradayMinutes?: number;
};

type CandlePoint = DailyPrice & {
  x: number;
  label: string;
};

type ChartMode = "auto" | "line" | "candle";

export type TradingIntradayPoint = {
  time: string;
  price: number;
  session: "regular" | "extended";
};

export type TradingIntradayCandle = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  volumeAvailable: boolean;
  vwap: number | null;
  session: "regular" | "extended";
};

const defaultRanges = [
  { label: "1m", days: null, intradayMinutes: 1 },
  { label: "5m", days: null, intradayMinutes: 5 },
  { label: "15m", days: null, intradayMinutes: 15 },
  { label: "1h", days: null, intradayMinutes: 60 },
  { label: "1D", days: null, bars: 1 },
  { label: "5D", days: null, bars: 5 },
  { label: "1W", days: 7 },
  { label: "1M", days: 31 },
  { label: "3M", days: 93 },
  { label: "YTD", days: "ytd" },
  { label: "1Y", days: 366 },
  { label: "5Y", days: 366 * 5 },
  { label: "ALL", days: null }
] as const satisfies CandleRange[];

export function TradingCandlestickChart({
  prices,
  ticker,
  intraday = [],
  intradayCandles = [],
  defaultRange = "1M",
  height = 430,
  previousClose,
  extendedPrice,
  subtitle
}: {
  prices: DailyPrice[];
  ticker: string;
  intraday?: TradingIntradayPoint[];
  intradayCandles?: TradingIntradayCandle[];
  defaultRange?: string;
  height?: number;
  previousClose?: number | null;
  extendedPrice?: number | null;
  subtitle?: string;
}) {
  const [rangeLabel, setRangeLabel] = useState(defaultRange);
  const [chartMode, setChartMode] = useState<ChartMode>("auto");
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const selectedRange = defaultRanges.find((range) => range.label === rangeLabel) ?? defaultRanges[0];
  const availableRanges = intradayCandles.length >= 2 ? defaultRanges : defaultRanges.filter((range) => !("intradayMinutes" in range));
  const selectedIntradayMinutes = "intradayMinutes" in selectedRange ? selectedRange.intradayMinutes : null;
  const showIntradayCandles = Boolean(selectedIntradayMinutes && intradayCandles.length >= 2);
  const showIntraday = rangeLabel === "1D" && intraday.length >= 2 && chartMode !== "candle";
  const showLine = showIntraday || chartMode === "line";
  const visiblePrices = useMemo(() => filterDailyPrices(prices, rangeLabel), [prices, rangeLabel]);
  const visibleIntradayCandles = useMemo(
    () => aggregateIntradayCandles(intradayCandles, selectedIntradayMinutes ?? 1),
    [intradayCandles, selectedIntradayMinutes]
  );
  const intradayCandlePrices = useMemo(() => visibleIntradayCandles.map(intradayCandleToDailyPrice), [visibleIntradayCandles]);
  const chartPrices = showIntradayCandles ? intradayCandlePrices : visiblePrices;
  const latest = visiblePrices[visiblePrices.length - 1];
  const latestChartPrice = chartPrices[chartPrices.length - 1];
  const first = visiblePrices[0];
  const latestIntraday = intraday[intraday.length - 1] ?? null;
  const latestIntradayCandle = visibleIntradayCandles[visibleIntradayCandles.length - 1] ?? null;
  const intradayBaseline = previousClose ?? intraday[0]?.price ?? null;
  const intradayCandleBaseline = previousClose ?? visibleIntradayCandles[0]?.open ?? null;
  const changePercent = showIntradayCandles && latestIntradayCandle && intradayCandleBaseline
    ? ((latestIntradayCandle.close - intradayCandleBaseline) / intradayCandleBaseline) * 100
    : showIntraday && latestIntraday && intradayBaseline
    ? ((latestIntraday.price - intradayBaseline) / intradayBaseline) * 100
    : latest && first && first.close > 0
      ? ((latest.close - first.close) / first.close) * 100
      : 0;
  const isUp = changePercent >= 0;
  const chart = useMemo(() => buildChart(chartPrices, previousClose, extendedPrice), [chartPrices, extendedPrice, previousClose]);
  const intradayChart = useMemo(() => buildIntradayChart(intraday, previousClose), [intraday, previousClose]);
  const vwapPath = useMemo(() => vwapLinePath(visibleIntradayCandles, chart), [chart, visibleIntradayCandles]);
  const hovered = hoverIndex !== null ? chart.points[hoverIndex] : null;
  const hoveredIntraday = hoverIndex !== null ? intradayChart.points[hoverIndex] : null;
  const active = hovered ?? latestChartPrice ?? latest;
  const activeIntraday = hoveredIntraday ?? latestIntraday;
  const latestPoint = chart.points[chart.points.length - 1] ?? null;
  const hasVolume = chartPrices.some((price) => price.volume > 0);
  const hasIntradayVwap = visibleIntradayCandles.some((candle) => Number.isFinite(candle.vwap));
  const activeChangePercent = active ? active.changePercent : changePercent;
  const activeVolumeRatio = active && chart.volumeAverage > 0 ? active.volume / chart.volumeAverage : null;
  const marketState = useMemo(
    () => resolveMarketState(chartPrices, chart, showIntradayCandles ? latestIntradayCandle?.session : showIntraday ? latestIntraday?.session : null),
    [chartPrices, chart, latestIntraday?.session, latestIntradayCandle?.session, showIntraday, showIntradayCandles]
  );

  return (
    <section className="max-w-full min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-[#050505] shadow-2xl shadow-black/35 ring-1 ring-white/5">
      <div className="flex flex-col gap-3 border-b border-white/10 bg-[linear-gradient(180deg,rgba(23,23,23,0.98),rgba(5,5,5,0.92))] px-4 py-4 sm:px-5 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-teal-200">{showIntraday || showIntradayCandles ? "Realtime" : "Candlestick"}</p>
            <span className="rounded-full border border-white/10 bg-white/[0.055] px-2 py-0.5 text-[10px] font-black text-slate-400">{showIntraday ? "1D line" : showIntradayCandles ? `${selectedRange.label} OHLC` : "OHLC"}</span>
            {showIntraday || showIntradayCandles ? (
              <span className="rounded-full border border-emerald-300/25 bg-emerald-300/10 px-2 py-0.5 text-[10px] font-black text-emerald-100">Live</span>
            ) : (
              <>
                <span className="rounded-full border border-violet-300/25 bg-violet-300/10 px-2 py-0.5 text-[10px] font-black text-violet-200">MA5</span>
                <span className="rounded-full border border-amber-300/25 bg-amber-300/10 px-2 py-0.5 text-[10px] font-black text-amber-100">MA20</span>
                <span className="rounded-full border border-teal-300/25 bg-teal-300/10 px-2 py-0.5 text-[10px] font-black text-teal-100">MA50</span>
              </>
            )}
            {showIntradayCandles && hasIntradayVwap ? <span className="rounded-full border border-sky-300/25 bg-sky-300/10 px-2 py-0.5 text-[10px] font-black text-sky-100">VWAP</span> : null}
            {showIntradayCandles && !hasVolume ? <span className="rounded-full border border-yellow-300/25 bg-yellow-300/10 px-2 py-0.5 text-[10px] font-black text-yellow-100">Volume N/A</span> : null}
          </div>
          <div className="mt-2 flex flex-wrap items-end gap-3">
            <h3 className="text-2xl font-black tracking-tight text-white">{ticker}</h3>
            <p className="pb-1 text-sm font-black text-slate-100 tabular-nums">{showIntradayCandles && latestIntradayCandle ? formatPrice(latestIntradayCandle.close) : showIntraday && latestIntraday ? formatPrice(latestIntraday.price) : latest ? formatPrice(latest.close) : "-"}</p>
            <p className={isUp ? "pb-1 text-sm font-black text-emerald-300" : "pb-1 text-sm font-black text-red-300"}>
              {changePercent >= 0 ? "+" : ""}{changePercent.toFixed(2)}%
            </p>
            {subtitle ? <p className="pb-1 text-xs font-semibold text-slate-500">{subtitle}</p> : null}
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:items-end">
          <div className="flex gap-1 overflow-x-auto rounded-xl border border-white/10 bg-black/50 p-1 [-webkit-overflow-scrolling:touch]">
            {(["auto", "line", "candle"] as const).map((mode) => (
              <button
                key={mode}
                className={chartMode === mode ? "whitespace-nowrap rounded-lg bg-white px-3 py-1.5 text-xs font-black text-neutral-950 shadow-lg shadow-black/30" : "whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-bold capitalize text-slate-400 hover:bg-white/10 hover:text-slate-100"}
                onClick={() => setChartMode(mode)}
                type="button"
              >
                {mode}
              </button>
            ))}
          </div>
          <div className="flex gap-1 overflow-x-auto rounded-xl border border-white/10 bg-black/50 p-1 [-webkit-overflow-scrolling:touch]">
            {availableRanges.map((range) => (
              <button
                key={range.label}
                className={range.label === rangeLabel ? "whitespace-nowrap rounded-lg bg-teal-300 px-3 py-1.5 text-xs font-black text-neutral-950 shadow-lg shadow-teal-950/30" : "whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-bold text-slate-400 hover:bg-white/10 hover:text-slate-100"}
                onClick={() => setRangeLabel(range.label)}
                type="button"
              >
                {range.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-2 border-b border-white/10 bg-black/[0.35] px-4 py-2.5 text-xs sm:px-5">
        {showIntraday ? (
          <>
            <OhlcItem label="Last" value={activeIntraday ? formatPrice(activeIntraday.price) : "-"} tone={isUp ? "up" : "down"} />
            <OhlcItem label="High" value={formatPrice(intradayChart.high)} tone="up" />
            <OhlcItem label="Low" value={formatPrice(intradayChart.low)} tone="down" />
            <OhlcItem label="Prev" value={previousClose ? formatPrice(previousClose) : "-"} />
            <OhlcItem label="Chg" value={`${changePercent >= 0 ? "+" : ""}${changePercent.toFixed(2)}%`} tone={isUp ? "up" : "down"} />
            <OhlcItem label="Session" value={activeIntraday?.session === "extended" ? "Extended" : "Regular"} />
          </>
        ) : showIntradayCandles ? (
          <>
            <OhlcItem label="O" value={active ? formatPrice(active.open) : "-"} />
            <OhlcItem label="H" value={active ? formatPrice(active.high) : "-"} tone="up" />
            <OhlcItem label="L" value={active ? formatPrice(active.low) : "-"} tone="down" />
            <OhlcItem label="C" value={active ? formatPrice(active.close) : "-"} tone={active && active.close >= active.open ? "up" : "down"} />
            <OhlcItem label="VWAP" value={latestIntradayCandle?.vwap ? formatPrice(latestIntradayCandle.vwap) : "N/A"} tone="up" />
            <OhlcItem label="Vol" value={active && active.volume > 0 ? formatVolume(active.volume) : "N/A"} />
            <OhlcItem label="RelVol" value={activeVolumeRatio ? `${activeVolumeRatio.toFixed(1)}x` : "N/A"} tone={activeVolumeRatio && activeVolumeRatio >= 1.5 ? "up" : "default"} />
          </>
        ) : (
          <>
            <OhlcItem label="O" value={active ? formatPrice(active.open) : "-"} />
            <OhlcItem label="H" value={active ? formatPrice(active.high) : "-"} tone="up" />
            <OhlcItem label="L" value={active ? formatPrice(active.low) : "-"} tone="down" />
            <OhlcItem label="C" value={active ? formatPrice(active.close) : "-"} tone={active && active.close >= active.open ? "up" : "down"} />
            <OhlcItem label="Vol" value={active ? formatVolume(active.volume) : "-"} />
            <OhlcItem label="RelVol" value={activeVolumeRatio ? `${activeVolumeRatio.toFixed(1)}x` : "-"} tone={activeVolumeRatio && activeVolumeRatio >= 1.5 ? "up" : "default"} />
            <OhlcItem label="Chg" value={`${activeChangePercent >= 0 ? "+" : ""}${activeChangePercent.toFixed(2)}%`} tone={activeChangePercent >= 0 ? "up" : "down"} />
          </>
        )}
      </div>

      <MarketStateStrip state={marketState} />

      <div className="relative max-w-full overflow-hidden bg-[#020202]">
        <svg
          className="block w-full select-none"
          style={{ height }}
          viewBox={`0 0 ${showIntraday ? intradayChart.width : chart.width} ${showIntraday ? intradayChart.height : chart.height}`}
          role="img"
          aria-label={`${ticker} ${showIntraday ? "realtime" : "candlestick"} chart`}
          onMouseLeave={() => setHoverIndex(null)}
          onMouseMove={(event) => {
            const svg = event.currentTarget;
            const rect = svg.getBoundingClientRect();
            const currentChart = showIntraday ? intradayChart : chart;
            const relativeX = ((event.clientX - rect.left) / rect.width) * currentChart.width;
            setHoverIndex(showIntraday ? intradayIndexFromX(relativeX, intradayChart) : indexFromX(relativeX, chart));
          }}
        >
          {showIntraday ? (
            <IntradaySvg
              chart={intradayChart}
              hovered={hoveredIntraday}
              isUp={isUp}
              previousClose={previousClose}
              ticker={ticker}
            />
          ) : showLine ? (
            <DailyLineSvg
              chart={chart}
              hovered={hovered}
              isUp={isUp}
              previousClose={previousClose}
              ticker={ticker}
              vwapPath={showIntradayCandles && hasIntradayVwap ? vwapPath : ""}
              hasVolume={hasVolume}
            />
          ) : (
          <>
          <defs>
            <linearGradient id={`candle-panel-${ticker}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="rgba(20,184,166,0.12)" />
              <stop offset="100%" stopColor="rgba(20,184,166,0)" />
            </linearGradient>
          </defs>
          <rect x="0" y="0" width={chart.width} height={chart.height} fill="#020202" />
          <rect x={chart.left} y={chart.top} width={chart.right - chart.left} height={chart.priceBottom - chart.top} rx="14" fill={`url(#candle-panel-${ticker})`} stroke="rgba(148,163,184,0.10)" />
          <rect x={chart.left} y={chart.volumeTop} width={chart.right - chart.left} height={chart.volumeHeight} rx="12" fill="rgba(15,23,42,0.35)" stroke="rgba(148,163,184,0.10)" />
          {chart.yTicks.map((tick) => (
            <g key={tick.value}>
              <line x1={chart.left} x2={chart.right} y1={tick.y} y2={tick.y} stroke="rgba(148,163,184,0.13)" />
              <rect x={chart.right + 10} y={tick.y - 10} width="62" height="20" rx="7" fill="rgba(15,23,42,0.80)" stroke="rgba(148,163,184,0.12)" />
              <text x={chart.right + 41} y={tick.y + 4} fill="#cbd5e1" fontSize="11" fontWeight="800" textAnchor="middle">{formatPrice(tick.value)}</text>
            </g>
          ))}
          {chart.xTicks.map((tick) => (
            <g key={`${tick.label}-${tick.x}`}>
              <line x1={tick.x} x2={tick.x} y1={chart.top} y2={chart.volumeBottom} stroke="rgba(148,163,184,0.055)" />
              <text x={tick.x} y={chart.height - 16} fill="#64748b" fontSize="11" fontWeight="700" textAnchor="middle">{tick.label}</text>
            </g>
          ))}
          <text x={chart.left + 10} y={chart.volumeTop + 18} fill="#64748b" fontSize="11" fontWeight="900">Volume</text>
          {previousClose ? (
            <g>
              <line x1={chart.left} x2={chart.right} y1={chart.y(previousClose)} y2={chart.y(previousClose)} stroke="rgba(203,213,225,0.38)" strokeDasharray="5 7" />
              <text x={chart.left + 10} y={chart.y(previousClose) - 6} fill="#94a3b8" fontSize="10" fontWeight="800">Prev close</text>
            </g>
          ) : null}
          <RangeLine chart={chart} value={chart.rangeHigh} label="Range high" tone="up" />
          <RangeLine chart={chart} value={chart.rangeLow} label="Range low" tone="down" />
          {latestPoint ? (
            <g>
              <line x1={chart.left} x2={chart.right} y1={chart.y(latestPoint.close)} y2={chart.y(latestPoint.close)} stroke={latestPoint.close >= latestPoint.open ? "rgba(34,197,94,0.44)" : "rgba(239,68,68,0.44)"} strokeDasharray="3 5" />
              <rect x={chart.right + 8} y={chart.y(latestPoint.close) - 12} width="72" height="24" rx="8" fill={latestPoint.close >= latestPoint.open ? "rgba(22,101,52,0.92)" : "rgba(127,29,29,0.92)"} stroke={latestPoint.close >= latestPoint.open ? "rgba(134,239,172,0.40)" : "rgba(252,165,165,0.40)"} />
              <text x={chart.right + 44} y={chart.y(latestPoint.close) + 4} fill="#f8fafc" fontSize="11" fontWeight="900" textAnchor="middle">{formatPrice(latestPoint.close)}</text>
            </g>
          ) : null}
          {hasVolume ? <VolumeProfile chart={chart} /> : null}
          <path d={linePath(chart.points, chart.y, "ma20")} fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" opacity="0.92" />
          <path d={linePath(chart.points, chart.y, "ma50")} fill="none" stroke="#2dd4bf" strokeWidth="2" strokeLinecap="round" opacity="0.92" />
          {showIntradayCandles && hasIntradayVwap && vwapPath ? <path d={vwapPath} fill="none" stroke="#38bdf8" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" opacity="0.95" /> : null}
          {chart.points.map((point) => {
            const up = point.close >= point.open;
            const color = up ? "#22c55e" : "#f43f5e";
            const bodyTop = chart.y(Math.max(point.open, point.close));
            const bodyBottom = chart.y(Math.min(point.open, point.close));
            const bodyHeight = Math.max(2, bodyBottom - bodyTop);
            const candleWidth = candleBodyWidth(chart.points.length, chart.step);
            return (
              <g key={point.date}>
                <line x1={point.x} x2={point.x} y1={chart.y(point.high)} y2={chart.y(point.low)} stroke={color} strokeWidth={chart.points.length <= 5 ? "2.2" : "1.5"} strokeLinecap="round" />
                <rect x={point.x - candleWidth / 2} y={bodyTop} width={candleWidth} height={bodyHeight} rx="2.5" fill={up ? "rgba(34,197,94,0.88)" : "rgba(244,63,94,0.90)"} stroke={color} strokeWidth="1" />
              </g>
            );
          })}
          {!hasVolume ? <VolumeUnavailable chart={chart} /> : null}
          {hovered ? (
            <g>
              <line x1={hovered.x} x2={hovered.x} y1={chart.top} y2={chart.volumeBottom} stroke="rgba(226,232,240,0.38)" strokeDasharray="4 5" />
              <line x1={chart.left} x2={chart.right} y1={chart.y(hovered.close)} y2={chart.y(hovered.close)} stroke="rgba(226,232,240,0.26)" strokeDasharray="4 5" />
              <rect x={Math.min(hovered.x + 12, chart.right - 206)} y={chart.top + 12} width="204" height="124" rx="14" fill="rgba(2,6,23,0.94)" stroke="rgba(148,163,184,0.30)" />
              <text x={Math.min(hovered.x + 28, chart.right - 156)} y={chart.top + 36} fill="#f8fafc" fontSize="12" fontWeight="800">{formatTooltipDate(hovered.date)}</text>
              <text x={Math.min(hovered.x + 28, chart.right - 156)} y={chart.top + 58} fill="#94a3b8" fontSize="11" fontWeight="700">O {formatPrice(hovered.open)}  H {formatPrice(hovered.high)}</text>
              <text x={Math.min(hovered.x + 28, chart.right - 156)} y={chart.top + 78} fill="#94a3b8" fontSize="11" fontWeight="700">L {formatPrice(hovered.low)}  C {formatPrice(hovered.close)}</text>
              <text x={Math.min(hovered.x + 28, chart.right - 156)} y={chart.top + 99} fill={hovered.close >= hovered.open ? "#86efac" : "#fca5a5"} fontSize="11" fontWeight="800">Body {formatSignedPercent(percentChange(hovered.open, hovered.close))} / Range {formatSignedPercent(percentRange(hovered.low, hovered.high, hovered.close), false)}</text>
              <text x={Math.min(hovered.x + 28, chart.right - 156)} y={chart.top + 120} fill={hovered.volume >= chart.volumeAverage * 1.5 ? "#fbbf24" : "#94a3b8"} fontSize="11" fontWeight="900">Vol {formatVolume(hovered.volume)} / {chart.volumeAverage > 0 ? `${(hovered.volume / chart.volumeAverage).toFixed(1)}x avg` : "N/A"}</text>
            </g>
          ) : null}
          </>
          )}
        </svg>
      </div>
    </section>
  );
}

function buildChart(prices: DailyPrice[], previousClose?: number | null, extendedPrice?: number | null) {
  const width = 1080;
  const height = 430;
  const left = 34;
  const right = 982;
  const top = 22;
  const priceBottom = 306;
  const volumeTop = 328;
  const volumeBottom = 390;
  const volumeHeight = volumeBottom - volumeTop;
  const fallbackPrice = prices[0]?.close ?? 1;
  const priceValues = prices.length ? prices.flatMap((price) => [price.high, price.low, price.ma20, price.ma50]) : [fallbackPrice];
  if (previousClose) priceValues.push(previousClose);
  if (extendedPrice) priceValues.push(extendedPrice);
  const rawMin = Math.min(...priceValues.filter(Number.isFinite));
  const rawMax = Math.max(...priceValues.filter(Number.isFinite));
  const span = Math.max(1, rawMax - rawMin);
  const min = rawMin - span * 0.08;
  const max = rawMax + span * 0.08;
  const y = (value: number) => top + ((max - value) / (max - min)) * (priceBottom - top);
  const step = prices.length > 1 ? (right - left) / (prices.length - 1) : right - left;
  const points: CandlePoint[] = prices.map((price, index) => ({
    ...price,
    x: prices.length > 1 ? left + index * step : (left + right) / 2,
    label: formatAxisDate(price.date)
  }));
  const yTicks = Array.from({ length: 5 }, (_, index) => {
    const value = min + ((max - min) / 4) * index;
    return { value, y: y(value) };
  }).reverse();
  const tickCount = Math.min(7, points.length);
  const xTicks = Array.from({ length: tickCount }, (_, index) => {
    const point = points[Math.round((index / Math.max(1, tickCount - 1)) * (points.length - 1))];
    return { x: point?.x ?? left, label: point?.label ?? "" };
  });
  const finiteHighs = prices.map((price) => price.high).filter(Number.isFinite);
  const finiteLows = prices.map((price) => price.low).filter(Number.isFinite);
  const finiteVolumes = prices.map((price) => price.volume).filter((volume) => Number.isFinite(volume) && volume > 0);
  const maxVolume = finiteVolumes.length ? Math.max(...finiteVolumes) : 1;
  const volumeAverage = finiteVolumes.length ? finiteVolumes.reduce((sum, volume) => sum + volume, 0) / finiteVolumes.length : 0;
  const volumeMedian = finiteVolumes.length ? percentile(finiteVolumes, 0.5) : 0;
  const volumeScaleMax = Math.max(
    1,
    finiteVolumes.length ? percentile(finiteVolumes, 0.96) * 1.15 : 1,
    volumeAverage * 1.8,
    volumeMedian * 2.2
  );
  const volumeY = (value: number) => volumeTop + (1 - Math.min(Math.max(value, 0), volumeScaleMax) / volumeScaleMax) * volumeHeight;
  const rangeHigh = finiteHighs.length ? Math.max(...finiteHighs) : rawMax;
  const rangeLow = finiteLows.length ? Math.min(...finiteLows) : rawMin;
  return { width, height, left, right, top, priceBottom, volumeTop, volumeBottom, volumeHeight, y, volumeY, points, step, yTicks, xTicks, rangeHigh, rangeLow, maxVolume, volumeAverage, volumeMedian, volumeScaleMax };
}

function DailyLineSvg({
  chart,
  hovered,
  isUp,
  previousClose,
  ticker,
  vwapPath = "",
  hasVolume = true
}: {
  chart: ReturnType<typeof buildChart>;
  hovered: CandlePoint | null;
  isUp: boolean;
  previousClose?: number | null;
  ticker: string;
  vwapPath?: string;
  hasVolume?: boolean;
}) {
  const latest = chart.points[chart.points.length - 1] ?? null;
  const stroke = isUp ? "#22c55e" : "#f43f5e";
  const fill = isUp ? "rgba(34,197,94,0.20)" : "rgba(244,63,94,0.20)";
  const path = dailyClosePath(chart.points, chart.y);
  const areaPath = latest && path ? `${path} L ${latest.x.toFixed(2)} ${chart.priceBottom} L ${chart.left} ${chart.priceBottom} Z` : "";

  return (
    <>
      <defs>
        <linearGradient id={`daily-line-fill-${ticker}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={fill} />
          <stop offset="64%" stopColor="rgba(20,184,166,0.045)" />
          <stop offset="100%" stopColor="rgba(0,0,0,0)" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width={chart.width} height={chart.height} fill="#020202" />
      <rect x={chart.left} y={chart.top} width={chart.right - chart.left} height={chart.priceBottom - chart.top} rx="14" fill="rgba(15,23,42,0.22)" stroke="rgba(148,163,184,0.10)" />
      <rect x={chart.left} y={chart.volumeTop} width={chart.right - chart.left} height={chart.volumeHeight} rx="12" fill="rgba(15,23,42,0.35)" stroke="rgba(148,163,184,0.10)" />
      {chart.yTicks.map((tick) => (
        <g key={tick.value}>
          <line x1={chart.left} x2={chart.right} y1={tick.y} y2={tick.y} stroke="rgba(148,163,184,0.13)" />
          <rect x={chart.right + 10} y={tick.y - 10} width="62" height="20" rx="7" fill="rgba(15,23,42,0.82)" stroke="rgba(148,163,184,0.12)" />
          <text x={chart.right + 41} y={tick.y + 4} fill="#cbd5e1" fontSize="11" fontWeight="800" textAnchor="middle">{formatPrice(tick.value)}</text>
        </g>
      ))}
      {chart.xTicks.map((tick) => (
        <g key={`${tick.label}-${tick.x}`}>
          <line x1={tick.x} x2={tick.x} y1={chart.top} y2={chart.volumeBottom} stroke="rgba(148,163,184,0.055)" />
          <text x={tick.x} y={chart.height - 16} fill="#64748b" fontSize="11" fontWeight="700" textAnchor="middle">{tick.label}</text>
        </g>
      ))}
      <text x={chart.left + 10} y={chart.volumeTop + 18} fill="#64748b" fontSize="11" fontWeight="900">Volume</text>
      {previousClose ? (
        <g>
          <line x1={chart.left} x2={chart.right} y1={chart.y(previousClose)} y2={chart.y(previousClose)} stroke="rgba(203,213,225,0.38)" strokeDasharray="5 7" />
          <text x={chart.left + 10} y={chart.y(previousClose) - 6} fill="#94a3b8" fontSize="10" fontWeight="800">Prev close</text>
        </g>
      ) : null}
      <RangeLine chart={chart} value={chart.rangeHigh} label="Range high" tone="up" />
      <RangeLine chart={chart} value={chart.rangeLow} label="Range low" tone="down" />
      {areaPath ? <path d={areaPath} fill={`url(#daily-line-fill-${ticker})`} /> : null}
      {/* MA lines (behind price line) */}
      <path d={linePath(chart.points, chart.y, "ma5")} fill="none" stroke="#a78bfa" strokeWidth="1.4" strokeLinecap="round" opacity="0.80" />
      <path d={linePath(chart.points, chart.y, "ma20")} fill="none" stroke="#f59e0b" strokeWidth="1.8" strokeLinecap="round" opacity="0.85" />
      <path d={linePath(chart.points, chart.y, "ma50")} fill="none" stroke="#2dd4bf" strokeWidth="1.8" strokeLinecap="round" opacity="0.85" />
      <path d={path} fill="none" stroke={stroke} strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
      {vwapPath ? <path d={vwapPath} fill="none" stroke="#38bdf8" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" opacity="0.95" /> : null}
      {hasVolume ? <VolumeProfile chart={chart} /> : <VolumeUnavailable chart={chart} />}
      {latest ? (
        <g>
          <line x1={chart.left} x2={chart.right} y1={chart.y(latest.close)} y2={chart.y(latest.close)} stroke={isUp ? "rgba(34,197,94,0.42)" : "rgba(244,63,94,0.42)"} strokeDasharray="3 5" />
          <rect x={chart.right + 8} y={chart.y(latest.close) - 12} width="72" height="24" rx="8" fill={isUp ? "rgba(22,101,52,0.92)" : "rgba(127,29,29,0.92)"} stroke={isUp ? "rgba(134,239,172,0.40)" : "rgba(252,165,165,0.40)"} />
          <text x={chart.right + 44} y={chart.y(latest.close) + 4} fill="#f8fafc" fontSize="11" fontWeight="900" textAnchor="middle">{formatPrice(latest.close)}</text>
        </g>
      ) : null}
      {hovered ? (
        <g>
          <line x1={hovered.x} x2={hovered.x} y1={chart.top} y2={chart.volumeBottom} stroke="rgba(226,232,240,0.38)" strokeDasharray="4 5" />
          <line x1={chart.left} x2={chart.right} y1={chart.y(hovered.close)} y2={chart.y(hovered.close)} stroke="rgba(226,232,240,0.26)" strokeDasharray="4 5" />
          <rect x={Math.min(hovered.x + 12, chart.right - 196)} y={chart.top + 12} width="194" height="112" rx="14" fill="rgba(2,6,23,0.94)" stroke="rgba(148,163,184,0.30)" />
          <text x={Math.min(hovered.x + 28, chart.right - 156)} y={chart.top + 36} fill="#f8fafc" fontSize="12" fontWeight="800">{formatTooltipDate(hovered.date)}</text>
          <text x={Math.min(hovered.x + 28, chart.right - 156)} y={chart.top + 60} fill={stroke} fontSize="15" fontWeight="900">{formatPrice(hovered.close)}</text>
          <text x={Math.min(hovered.x + 28, chart.right - 156)} y={chart.top + 82} fill="#94a3b8" fontSize="11" fontWeight="700">Range {formatSignedPercent(percentRange(hovered.low, hovered.high, hovered.close), false)}</text>
          <text x={Math.min(hovered.x + 28, chart.right - 156)} y={chart.top + 103} fill={hovered.volume >= chart.volumeAverage * 1.5 ? "#fbbf24" : "#94a3b8"} fontSize="11" fontWeight="900">Vol {formatVolume(hovered.volume)} / {chart.volumeAverage > 0 ? `${(hovered.volume / chart.volumeAverage).toFixed(1)}x avg` : "N/A"}</text>
        </g>
      ) : null}
    </>
  );
}

function buildIntradayChart(points: TradingIntradayPoint[], previousClose?: number | null) {
  const width = 1080;
  const height = 430;
  const left = 34;
  const right = 982;
  const top = 26;
  const bottom = 382;
  const values = points.map((point) => point.price).filter(Number.isFinite);
  if (previousClose) values.push(previousClose);
  const rawMin = values.length ? Math.min(...values) : 0;
  const rawMax = values.length ? Math.max(...values) : 1;
  const span = Math.max(0.01, rawMax - rawMin);
  const min = rawMin - span * 0.16;
  const max = rawMax + span * 0.16;
  const y = (value: number) => top + ((max - value) / (max - min)) * (bottom - top);
  const step = points.length > 1 ? (right - left) / (points.length - 1) : right - left;
  const chartPoints = points.map((point, index) => ({
    ...point,
    x: points.length > 1 ? left + index * step : (left + right) / 2,
    y: y(point.price),
    label: formatTime(point.time)
  }));
  const pointPrices = points.map((point) => point.price).filter(Number.isFinite);
  const high = pointPrices.length ? Math.max(...pointPrices) : previousClose ?? 0;
  const low = pointPrices.length ? Math.min(...pointPrices) : previousClose ?? 0;
  const yTicks = Array.from({ length: 6 }, (_, index) => {
    const value = min + ((max - min) / 5) * index;
    return { value, y: y(value) };
  }).reverse();
  const tickCount = Math.min(7, chartPoints.length);
  const xTicks = Array.from({ length: tickCount }, (_, index) => {
    const point = chartPoints[Math.round((index / Math.max(1, tickCount - 1)) * (chartPoints.length - 1))];
    return { x: point?.x ?? left, label: point?.label ?? "" };
  });
  return { width, height, left, right, top, bottom, y, points: chartPoints, step, yTicks, xTicks, high, low };
}

function IntradaySvg({
  chart,
  hovered,
  isUp,
  previousClose,
  ticker
}: {
  chart: ReturnType<typeof buildIntradayChart>;
  hovered: ReturnType<typeof buildIntradayChart>["points"][number] | null;
  isUp: boolean;
  previousClose?: number | null;
  ticker: string;
}) {
  const latest = chart.points[chart.points.length - 1] ?? null;
  const stroke = isUp ? "#22c55e" : "#f43f5e";
  const fill = isUp ? "rgba(34,197,94,0.20)" : "rgba(244,63,94,0.20)";
  const path = intradayPath(chart.points);
  const areaPath = latest && path ? `${path} L ${latest.x.toFixed(2)} ${chart.bottom} L ${chart.left} ${chart.bottom} Z` : "";

  return (
    <>
      <defs>
        <linearGradient id={`intraday-fill-${ticker}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={fill} />
          <stop offset="62%" stopColor="rgba(20,184,166,0.045)" />
          <stop offset="100%" stopColor="rgba(0,0,0,0)" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width={chart.width} height={chart.height} fill="#020202" />
      <rect x={chart.left} y={chart.top} width={chart.right - chart.left} height={chart.bottom - chart.top} rx="16" fill="rgba(15,23,42,0.20)" stroke="rgba(148,163,184,0.11)" />
      {chart.yTicks.map((tick) => (
        <g key={tick.value}>
          <line x1={chart.left} x2={chart.right} y1={tick.y} y2={tick.y} stroke="rgba(148,163,184,0.13)" />
          <rect x={chart.right + 10} y={tick.y - 10} width="62" height="20" rx="7" fill="rgba(15,23,42,0.82)" stroke="rgba(148,163,184,0.12)" />
          <text x={chart.right + 41} y={tick.y + 4} fill="#cbd5e1" fontSize="11" fontWeight="800" textAnchor="middle">{formatPrice(tick.value)}</text>
        </g>
      ))}
      {chart.xTicks.map((tick) => (
        <g key={`${tick.label}-${tick.x}`}>
          <line x1={tick.x} x2={tick.x} y1={chart.top} y2={chart.bottom} stroke="rgba(148,163,184,0.055)" />
          <text x={tick.x} y={chart.height - 18} fill="#64748b" fontSize="11" fontWeight="800" textAnchor="middle">{tick.label}</text>
        </g>
      ))}
      {previousClose ? (
        <g>
          <line x1={chart.left} x2={chart.right} y1={chart.y(previousClose)} y2={chart.y(previousClose)} stroke="rgba(203,213,225,0.40)" strokeDasharray="5 7" />
          <text x={chart.left + 10} y={chart.y(previousClose) - 8} fill="#94a3b8" fontSize="10" fontWeight="900">Prev close</text>
        </g>
      ) : null}
      {areaPath ? <path d={areaPath} fill={`url(#intraday-fill-${ticker})`} /> : null}
      <path d={path} fill="none" stroke={stroke} strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
      {chart.points.map((point, index) => {
        const previous = chart.points[index - 1];
        const sessionChanged = previous && previous.session !== point.session;
        if (!sessionChanged && index !== chart.points.length - 1) return null;
        return <circle key={`${point.time}-${index}`} cx={point.x} cy={point.y} r={index === chart.points.length - 1 ? 5 : 3.5} fill={point.session === "extended" ? "#f59e0b" : stroke} stroke="#020202" strokeWidth="2" />;
      })}
      {latest ? (
        <g>
          <line x1={chart.left} x2={chart.right} y1={latest.y} y2={latest.y} stroke={isUp ? "rgba(34,197,94,0.42)" : "rgba(244,63,94,0.42)"} strokeDasharray="3 5" />
          <rect x={chart.right + 8} y={latest.y - 12} width="72" height="24" rx="8" fill={isUp ? "rgba(22,101,52,0.92)" : "rgba(127,29,29,0.92)"} stroke={isUp ? "rgba(134,239,172,0.40)" : "rgba(252,165,165,0.40)"} />
          <text x={chart.right + 44} y={latest.y + 4} fill="#f8fafc" fontSize="11" fontWeight="900" textAnchor="middle">{formatPrice(latest.price)}</text>
        </g>
      ) : null}
      {hovered ? (
        <g>
          <line x1={hovered.x} x2={hovered.x} y1={chart.top} y2={chart.bottom} stroke="rgba(226,232,240,0.38)" strokeDasharray="4 5" />
          <line x1={chart.left} x2={chart.right} y1={hovered.y} y2={hovered.y} stroke="rgba(226,232,240,0.26)" strokeDasharray="4 5" />
          <rect x={Math.min(hovered.x + 12, chart.right - 174)} y={chart.top + 14} width="172" height="82" rx="14" fill="rgba(2,6,23,0.94)" stroke="rgba(148,163,184,0.30)" />
          <text x={Math.min(hovered.x + 28, chart.right - 158)} y={chart.top + 39} fill="#f8fafc" fontSize="12" fontWeight="900">{hovered.label}</text>
          <text x={Math.min(hovered.x + 28, chart.right - 158)} y={chart.top + 62} fill={stroke} fontSize="15" fontWeight="900">{formatPrice(hovered.price)}</text>
          <text x={Math.min(hovered.x + 28, chart.right - 158)} y={chart.top + 82} fill="#94a3b8" fontSize="11" fontWeight="800">{hovered.session === "extended" ? "Extended" : "Regular"}</text>
        </g>
      ) : null}
    </>
  );
}

function filterDailyPrices(prices: DailyPrice[], rangeLabel: string) {
  const currentRange = defaultRanges.find((range) => range.label === rangeLabel) ?? defaultRanges[1];
  if ("bars" in currentRange && currentRange.bars) return prices.slice(-currentRange.bars);
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

function aggregateIntradayCandles(candles: TradingIntradayCandle[], intervalMinutes: number) {
  if (intervalMinutes <= 1) return recomputeVwap(candles);
  const buckets = new Map<number, TradingIntradayCandle[]>();
  for (const candle of candles) {
    const time = new Date(candle.time).getTime();
    if (!Number.isFinite(time)) continue;
    const bucketTime = Math.floor(time / (intervalMinutes * 60 * 1000)) * intervalMinutes * 60 * 1000;
    const bucket = buckets.get(bucketTime) ?? [];
    bucket.push(candle);
    buckets.set(bucketTime, bucket);
  }

  const aggregated = Array.from(buckets.entries())
    .sort(([left], [right]) => left - right)
    .map(([bucketTime, bucket]) => {
      const first = bucket[0];
      const last = bucket[bucket.length - 1];
      const high = Math.max(...bucket.map((item) => item.high));
      const low = Math.min(...bucket.map((item) => item.low));
      const volume = bucket.reduce((sum, item) => sum + item.volume, 0);
      return {
        time: new Date(bucketTime).toISOString(),
        open: first.open,
        high,
        low,
        close: last.close,
        volume,
        volumeAvailable: volume > 0,
        vwap: last.vwap,
        session: bucket.some((item) => item.session === "extended") ? "extended" as const : "regular" as const
      };
    });
  return recomputeVwap(aggregated);
}

function recomputeVwap(candles: TradingIntradayCandle[]) {
  let cumulativeTypicalVolume = 0;
  let cumulativeVolume = 0;
  return candles.map((candle) => {
    const typicalPrice = (candle.high + candle.low + candle.close) / 3;
    if (candle.volumeAvailable && candle.volume > 0) {
      cumulativeTypicalVolume += typicalPrice * candle.volume;
      cumulativeVolume += candle.volume;
    }
    return {
      ...candle,
      vwap: cumulativeVolume > 0 ? cumulativeTypicalVolume / cumulativeVolume : null
    };
  });
}

function intradayCandleToDailyPrice(candle: TradingIntradayCandle): DailyPrice {
  return {
    date: candle.time,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume,
    changePercent: candle.open > 0 ? ((candle.close - candle.open) / candle.open) * 100 : 0,
    volumeAverage20: 0,
    volumeRatio: 0,
    intradayRangePercent: candle.close > 0 ? ((candle.high - candle.low) / candle.close) * 100 : 0,
    rsi: 50,
    macd: 0,
    macdSignal: 0,
    macdHistogram: 0,
    macdDirection: candle.close >= candle.open ? "上昇" : "低下",
    rsiSignal: "中立",
    high20Breakout: "",
    ma5: candle.vwap ?? candle.close,
    ma20: candle.vwap ?? candle.close,
    ma50: candle.vwap ?? candle.close,
    volumeAverage: 0,
    closeAfter5Days: null,
    changeAfter5Days: null,
    closeAfter10Days: null,
    changeAfter10Days: null,
    score: 0,
    pattern: "",
    comment: "Intraday candle",
    source: "Yahoo Finance intraday"
  };
}

function indexFromX(x: number, chart: ReturnType<typeof buildChart>) {
  if (!chart.points.length) return null;
  const index = Math.round((x - chart.left) / chart.step);
  return Math.max(0, Math.min(chart.points.length - 1, index));
}

function intradayIndexFromX(x: number, chart: ReturnType<typeof buildIntradayChart>) {
  if (!chart.points.length) return null;
  const index = Math.round((x - chart.left) / chart.step);
  return Math.max(0, Math.min(chart.points.length - 1, index));
}

function linePath(points: CandlePoint[], y: (value: number) => number, key: "ma5" | "ma20" | "ma50") {
  if (points.length < 2) return "";
  const valid = points.filter((point) => Number.isFinite(point[key]));
  if (valid.length < 2) return "";
  return valid
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${y(point[key]).toFixed(2)}`)
    .join(" ");
}

function candleBodyWidth(pointCount: number, step: number) {
  if (pointCount <= 1) return 52;
  if (pointCount <= 5) return 38;
  if (pointCount <= 12) return 26;
  if (pointCount <= 36) return Math.max(10, Math.min(18, step * 0.58));
  return Math.max(4, Math.min(12, step * 0.62));
}

function intradayPath(points: ReturnType<typeof buildIntradayChart>["points"]) {
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(" ");
}

function dailyClosePath(points: CandlePoint[], y: (value: number) => number) {
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${y(point.close).toFixed(2)}`)
    .join(" ");
}

function vwapLinePath(candles: TradingIntradayCandle[], chart: ReturnType<typeof buildChart>) {
  if (candles.length < 2) return "";
  return candles
    .map((candle, index) => {
      const point = chart.points[index];
      const vwap = candle.vwap;
      if (!point || typeof vwap !== "number" || !Number.isFinite(vwap)) return "";
      return `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${chart.y(vwap).toFixed(2)}`;
    })
    .filter(Boolean)
    .join(" ");
}

type MarketState = {
  trend: { label: string; value: string; tone: "up" | "down" | "neutral" };
  range: { label: string; value: string; tone: "up" | "down" | "neutral" };
  volume: { label: string; value: string; tone: "up" | "down" | "neutral" };
  session: { label: string; value: string; tone: "up" | "down" | "neutral" };
};

function resolveMarketState(
  prices: DailyPrice[],
  chart: ReturnType<typeof buildChart>,
  session?: TradingIntradayCandle["session"] | TradingIntradayPoint["session"] | null
): MarketState {
  const first = prices[0];
  const latest = prices[prices.length - 1];
  const trendPercent = first && latest ? percentChange(first.close, latest.close) : 0;
  const latestVolumeRatio = latest && chart.volumeAverage > 0 ? latest.volume / chart.volumeAverage : 0;
  const rangePercent = latest ? percentRange(chart.rangeLow, chart.rangeHigh, latest.close) : 0;
  const closesAboveMa20 = prices.slice(-5).filter((price) => Number.isFinite(price.ma20) && price.close >= price.ma20).length;
  const trendTone = trendPercent > 0.4 ? "up" : trendPercent < -0.4 ? "down" : "neutral";
  const volumeTone = latestVolumeRatio >= 1.5 ? "up" : latestVolumeRatio > 0 && latestVolumeRatio < 0.7 ? "down" : "neutral";

  return {
    trend: {
      label: "Trend",
      value: `${formatSignedPercent(trendPercent)}${closesAboveMa20 >= 4 ? " / MA20+" : ""}`,
      tone: trendTone
    },
    range: {
      label: "Range",
      value: rangePercent > 0 ? `${rangePercent.toFixed(1)}% band` : "-",
      tone: rangePercent >= 8 ? "up" : rangePercent <= 2 && rangePercent > 0 ? "neutral" : "neutral"
    },
    volume: {
      label: "Volume",
      value: latestVolumeRatio > 0 ? `${latestVolumeRatio.toFixed(1)}x avg` : "N/A",
      tone: volumeTone
    },
    session: {
      label: "Session",
      value: session === "extended" ? "Extended" : session === "regular" ? "Regular" : "Daily",
      tone: session === "extended" ? "neutral" : trendTone
    }
  };
}

function MarketStateStrip({ state }: { state: MarketState }) {
  return (
    <div className="grid grid-cols-2 gap-px border-b border-white/10 bg-white/10 text-xs sm:grid-cols-4">
      {Object.values(state).map((item) => (
        <div key={item.label} className="min-w-0 bg-[#050505] px-4 py-3 sm:px-5">
          <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">{item.label}</p>
          <p className={`mt-1 truncate font-black tabular-nums ${stateToneClass(item.tone)}`}>{item.value}</p>
        </div>
      ))}
    </div>
  );
}

function stateToneClass(tone: "up" | "down" | "neutral") {
  if (tone === "up") return "text-emerald-300";
  if (tone === "down") return "text-rose-300";
  return "text-slate-100";
}

function RangeLine({
  chart,
  value,
  label,
  tone
}: {
  chart: ReturnType<typeof buildChart>;
  value: number;
  label: string;
  tone: "up" | "down";
}) {
  if (!Number.isFinite(value)) return null;
  const y = chart.y(value);
  const color = tone === "up" ? "rgba(45,212,191,0.52)" : "rgba(251,113,133,0.52)";
  const textColor = tone === "up" ? "#5eead4" : "#fda4af";
  return (
    <g>
      <line x1={chart.left} x2={chart.right} y1={y} y2={y} stroke={color} strokeDasharray="2 6" />
      <rect x={chart.left + 10} y={y - 13} width="78" height="22" rx="8" fill="rgba(2,6,23,0.72)" stroke={color} />
      <text x={chart.left + 49} y={y + 2.5} fill={textColor} fontSize="10" fontWeight="900" textAnchor="middle">{label}</text>
    </g>
  );
}

function VolumeProfile({ chart }: { chart: ReturnType<typeof buildChart> }) {
  const averageY = chart.volumeAverage > 0 ? chart.volumeY(chart.volumeAverage) : null;
  const heavyVolumeY = chart.volumeAverage > 0 ? chart.volumeY(chart.volumeAverage * 1.5) : null;

  return (
    <g>
      <rect x={chart.left} y={chart.volumeTop} width={chart.right - chart.left} height={chart.volumeHeight} rx="12" fill="rgba(15,23,42,0.18)" stroke="rgba(148,163,184,0.08)" />
      {heavyVolumeY ? (
        <g>
          <line x1={chart.left} x2={chart.right} y1={heavyVolumeY} y2={heavyVolumeY} stroke="rgba(20,184,166,0.42)" strokeDasharray="2 7" />
          <text x={chart.left + 72} y={heavyVolumeY - 5} fill="#5eead4" fontSize="10" fontWeight="900" textAnchor="middle">1.5x VOL</text>
        </g>
      ) : null}
      {averageY ? (
        <g>
          <line x1={chart.left} x2={chart.right} y1={averageY} y2={averageY} stroke="rgba(251,191,36,0.72)" strokeDasharray="5 5" />
          <rect x={chart.right - 90} y={averageY - 11} width="82" height="22" rx="8" fill="rgba(120,53,15,0.82)" stroke="rgba(251,191,36,0.30)" />
          <text x={chart.right - 49} y={averageY + 3.5} fill="#fde68a" fontSize="10" fontWeight="900" textAnchor="middle">AVG VOL</text>
        </g>
      ) : null}
      <text x={chart.left + 10} y={chart.volumeTop + 18} fill="#94a3b8" fontSize="11" fontWeight="900">Volume</text>
      <text x={chart.right - 8} y={chart.volumeTop + 18} fill="#64748b" fontSize="10" fontWeight="900" textAnchor="end">Max {formatVolume(chart.maxVolume)} / Avg {formatVolume(chart.volumeAverage)}</text>
      {chart.points.map((point) => {
        const up = point.close >= point.open;
        const candleWidth = candleBodyWidth(chart.points.length, chart.step);
        const barWidth = Math.max(3, Math.min(candleWidth, chart.step * 0.72));
        const barY = chart.volumeY(point.volume);
        const barHeight = Math.max(1.5, chart.volumeBottom - barY);
        const relativeVolume = chart.volumeAverage > 0 ? point.volume / chart.volumeAverage : 0;
        const isHeavyVolume = relativeVolume >= 1.5;
        const isClipped = point.volume > chart.volumeScaleMax;
        const fill = up
          ? isHeavyVolume ? "rgba(74,222,128,0.78)" : "rgba(34,197,94,0.38)"
          : isHeavyVolume ? "rgba(251,113,133,0.78)" : "rgba(244,63,94,0.38)";

        return (
          <g key={`volume-${point.date}`}>
            {isHeavyVolume ? (
              <rect
                x={point.x - barWidth / 2 - 1.5}
                y={barY - 3}
                width={barWidth + 3}
                height={barHeight + 3}
                rx="3"
                fill={up ? "rgba(34,197,94,0.12)" : "rgba(244,63,94,0.12)"}
                stroke={up ? "rgba(134,239,172,0.30)" : "rgba(253,164,175,0.30)"}
              />
            ) : null}
            <rect x={point.x - barWidth / 2} y={barY} width={barWidth} height={barHeight} rx="2.5" fill={fill} />
            {isClipped ? <circle cx={point.x} cy={chart.volumeTop + 5} r="2.6" fill="#fde68a" /> : null}
          </g>
        );
      })}
    </g>
  );
}

function VolumeUnavailable({ chart }: { chart: ReturnType<typeof buildChart> }) {
  return (
    <g>
      <rect x={chart.left + 10} y={chart.volumeTop + 20} width="226" height="28" rx="10" fill="rgba(113,63,18,0.28)" stroke="rgba(252,211,77,0.24)" />
      <text x={chart.left + 24} y={chart.volumeTop + 38} fill="#fde68a" fontSize="11" fontWeight="900">Volume unavailable from Yahoo feed</text>
    </g>
  );
}

function OhlcItem({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "up" | "down" }) {
  const color = tone === "up" ? "text-emerald-300" : tone === "down" ? "text-rose-300" : "text-slate-100";
  return (
    <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap">
      <span className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">{label}</span>
      <span className={`font-black tabular-nums ${color}`}>{value}</span>
    </span>
  );
}

function formatPrice(value: number) {
  if (!Number.isFinite(value)) return "-";
  if (Math.abs(value) >= 1000) {
    return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  }
  if (Math.abs(value) >= 100) {
    return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (Math.abs(value) >= 1) {
    return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 3 });
  }
  return value.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
}

function formatVolume(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value >= 1_000_000_000) return `${trimNumber(value / 1_000_000_000, 2)}B`;
  if (value >= 1_000_000) return `${trimNumber(value / 1_000_000, 1)}M`;
  if (value >= 1_000) return `${trimNumber(value / 1_000, 1)}K`;
  return Math.round(value).toLocaleString("en-US");
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatAxisDate(value: string) {
  if (value.includes("T")) return formatTime(value);
  const [year, month, day] = value.split("-");
  if (year && month && day) return `${Number(month)}/${Number(day)}`;
  return value.slice(0, 5);
}

function formatTooltipDate(value: string) {
  if (value.includes("T")) {
    return new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date(value));
  }
  const [year, month, day] = value.split("-");
  if (year && month && day) return `${year}/${month}/${day}`;
  return value;
}

function percentChange(from: number, to: number) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from <= 0) return 0;
  return ((to - from) / from) * 100;
}

function percentRange(low: number, high: number, close: number) {
  if (!Number.isFinite(low) || !Number.isFinite(high) || !Number.isFinite(close) || close <= 0) return 0;
  return ((high - low) / close) * 100;
}

function formatSignedPercent(value: number, showSign = true) {
  if (!Number.isFinite(value)) return "-";
  const sign = showSign && value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function percentile(values: number[], percentileValue: number) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * percentileValue)));
  return sorted[index];
}

function trimNumber(value: number, maximumFractionDigits: number) {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits
  });
}
