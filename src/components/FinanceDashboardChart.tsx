"use client";

import { TradingCandlestickChart } from "@/components/TradingCandlestickChart";
import type { DailyPrice } from "@/types";

export type IntradayPoint = {
  time: string;
  price: number;
  session: "regular" | "extended";
};

export type IntradayCandle = {
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

export function FinanceDashboardChart({
  prices,
  ticker,
  intraday = [],
  intradayCandles = [],
  previousClose,
  extendedPrice
}: {
  prices: DailyPrice[];
  ticker: string;
  intraday?: IntradayPoint[];
  intradayCandles?: IntradayCandle[];
  previousClose?: number | null;
  extendedPrice?: number | null;
}) {
  return (
    <TradingCandlestickChart
      prices={prices}
      ticker={ticker}
      intraday={intraday}
      intradayCandles={intradayCandles}
      defaultRange={intradayCandles.length >= 2 ? "1m" : "1M"}
      height="clamp(330px, 58vh, 390px)"
      previousClose={previousClose}
      extendedPrice={extendedPrice}
      subtitle={intradayCandles.length >= 2 ? "1m OHLC / VWAP" : intraday.length >= 2 ? "Live feed / Daily candles" : "Daily candles"}
    />
  );
}
