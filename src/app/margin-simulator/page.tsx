"use client";

import { useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { LiveWatchlistStrip } from "@/components/LiveWatchlistStrip";
import { HeaderPill, PageHeader } from "@/components/PageHeader";
import { DataTable } from "@/components/DataTable";
import { StatCard } from "@/components/StatCard";
import { stockDataProviderPriorityLabel } from "@/lib/data-provider-policy";
import {
  buildPositionComparisons,
  buildScenarios,
  calculateMarginSummary,
  defaultMarginInputs,
  type MarginInputs,
  type MarginScenario
} from "@/lib/margin-simulator";
import type { DailyPrice, NewsItem, Stock, WatchStatus } from "@/types";

type TradeSide = "auto" | "margin_buy" | "short_sell";
type SearchMarket = "us" | "jp";

type StockSearchResult = {
  ok: boolean;
  mode: "live" | "mock";
  stock: Stock;
  price: DailyPrice;
  prices: DailyPrice[];
  news: NewsItem[];
  score: number;
  status: WatchStatus;
  entryPlan: {
    side: "信用買い候補" | "信用売り候補" | "見送り・監視";
    confidence: number;
    takeProfitProbability: number;
    entryPrice: number;
    takeProfitPrice: number;
    stopLossPrice: number;
    riskReward: number;
    timeHorizon: string;
    summary: string;
    reasons: string[];
    cautions: string[];
  };
  warning?: string;
  error?: string;
};

const inputRows: { key: keyof MarginInputs; label: string; suffix: string; step?: string }[] = [
  { key: "collateral", label: "保証金", suffix: "円" },
  { key: "buyPrice", label: "買値", suffix: "円" },
  { key: "targetPrice", label: "目標売値", suffix: "円" },
  { key: "stopLossPrice", label: "損切り価格", suffix: "円" },
  { key: "holdingDays", label: "保有日数", suffix: "日" },
  { key: "marginRate", label: "委託保証金率", suffix: "%", step: "0.1" },
  { key: "maintenanceRate", label: "追証判定ライン", suffix: "%", step: "0.1" },
  { key: "dangerRate", label: "10%ライン", suffix: "%", step: "0.1" },
  { key: "interestRate", label: "買方金利 年率", suffix: "%", step: "0.01" },
  { key: "taxRate", label: "税率", suffix: "%", step: "0.001" },
  { key: "fee", label: "売買手数料", suffix: "円" },
  { key: "unit", label: "売買単位", suffix: "株" },
  { key: "expiryDays", label: "返済期限メモ", suffix: "日" }
];

function yen(value: number) {
  return new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 }).format(Math.round(value));
}

function num(value: number) {
  return new Intl.NumberFormat("ja-JP").format(Math.round(value));
}

function pct(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function price(value: number) {
  return `${value.toFixed(1)}円`;
}

function formatMarketPrice(ticker: string, value: number) {
  if (isJapaneseTicker(ticker)) return `${new Intl.NumberFormat("ja-JP").format(Math.round(value))}円`;
  return `$${value.toFixed(2)}`;
}

function isJapaneseTicker(ticker: string) {
  return /^\d{4}(\.T|\.JP)?$/i.test(ticker);
}

function normalizeTickerForMarket(ticker: string, market: SearchMarket) {
  const normalized = ticker.trim().toUpperCase();
  if (market === "jp") {
    if (/^\d{4}$/.test(normalized)) return `${normalized}.T`;
    if (/^\d{4}\.JP$/i.test(normalized)) return normalized.replace(/\.JP$/i, ".T");
  }
  return normalized;
}

function scenarioTone(status: MarginScenario["status"]) {
  if (status === "10%割れ候補") return "bg-red-500/20 text-red-200 ring-red-400/30";
  if (status === "追証候補") return "bg-yellow-300/20 text-yellow-100 ring-yellow-300/30";
  if (status === "利確候補") return "bg-green-400/15 text-green-200 ring-green-400/30";
  return "bg-slate-800 text-slate-300 ring-white/10";
}

function riskTone(label: string) {
  if (label === "かなり攻め") return "text-red-300";
  if (label === "攻め") return "text-yellow-200";
  if (label === "中間") return "text-sky-200";
  return "text-green-300";
}

function toInputValue(inputs: MarginInputs, key: keyof MarginInputs) {
  const value = inputs[key];
  if (key === "marginRate" || key === "maintenanceRate" || key === "dangerRate" || key === "interestRate" || key === "taxRate") {
    return String(Number((value * 100).toFixed(4)));
  }
  return String(value);
}

function fromInputValue(key: keyof MarginInputs, value: number) {
  if (key === "marginRate" || key === "maintenanceRate" || key === "dangerRate" || key === "interestRate" || key === "taxRate") {
    return value / 100;
  }
  return value;
}

function buildInputDraft(inputs: MarginInputs): Record<keyof MarginInputs, string> {
  return inputRows.reduce((draft, row) => {
    draft[row.key] = toInputValue(inputs, row.key);
    return draft;
  }, {} as Record<keyof MarginInputs, string>);
}

export default function MarginSimulatorPage() {
  const [inputs, setInputs] = useState<MarginInputs>(defaultMarginInputs);
  const [inputDraft, setInputDraft] = useState<Record<keyof MarginInputs, string>>(() => buildInputDraft(defaultMarginInputs));
  const [ticker, setTicker] = useState("RGTI");
  const [searchMarket, setSearchMarket] = useState<SearchMarket>("us");
  const [tradeSide, setTradeSide] = useState<TradeSide>("auto");
  const [searchResult, setSearchResult] = useState<StockSearchResult | null>(null);
  const [searchStatus, setSearchStatus] = useState<"idle" | "running" | "error">("idle");
  const [searchError, setSearchError] = useState("");
  const summary = useMemo(() => calculateMarginSummary(inputs), [inputs]);
  const scenarios = useMemo(() => buildScenarios(inputs), [inputs]);
  const comparisons = useMemo(() => buildPositionComparisons(inputs), [inputs]);
  const targetScenario = scenarios.find((item) => item.price >= inputs.targetPrice) ?? scenarios[scenarios.length - 1];
  const stopScenario = scenarios.find((item) => item.price >= inputs.stopLossPrice) ?? scenarios[0];
  const isBuyCandidate = searchResult?.entryPlan.side === "信用買い候補";
  const isShortCandidate = searchResult?.entryPlan.side === "信用売り候補";

  function updateInput(key: keyof MarginInputs, rawValue: string) {
    setInputDraft((current) => ({ ...current, [key]: rawValue }));
    if (rawValue === "" || rawValue === "." || rawValue === "-") return;
    const value = Number(rawValue);
    if (!Number.isFinite(value)) return;
    setInputs((current) => ({
      ...current,
      [key]: Math.max(fromInputValue(key, value), 0)
    }));
  }

  function resetInputs() {
    setInputs(defaultMarginInputs);
    setInputDraft(buildInputDraft(defaultMarginInputs));
  }

  async function searchTicker() {
    const normalized = normalizeTickerForMarket(ticker, searchMarket);
    if (!normalized) return;
    setSearchStatus("running");
    setSearchError("");
    try {
      const response = await fetch("/api/stock-search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ticker: normalized, side: tradeSide, market: searchMarket })
      });
      const result = await response.json() as StockSearchResult;
      if (!response.ok || !result.ok) throw new Error(result.error ?? "検索に失敗しました。");
      setSearchResult(result);
      setTicker(normalized);
      setSearchStatus("idle");
    } catch (error) {
      setSearchStatus("error");
      setSearchError(error instanceof Error ? error.message : "検索に失敗しました。");
    }
  }

  function applySearchPriceToSimulator() {
    if (!searchResult) return;
    if (searchResult.entryPlan.side !== "信用買い候補") return;
    if (!isJapaneseTicker(searchResult.stock.ticker)) return;
    const nextInputs = {
      ...inputs,
      buyPrice: Number(searchResult.price.close.toFixed(2)),
      targetPrice: Number(searchResult.entryPlan.takeProfitPrice.toFixed(2)),
      stopLossPrice: Number(searchResult.entryPlan.stopLossPrice.toFixed(2))
    };
    setInputs(nextInputs);
    setInputDraft(buildInputDraft(nextInputs));
  }

  return (
    <div className="space-y-5">
      <LiveWatchlistStrip />
      <PageHeader
        eyebrow="Margin Simulator"
        title="信用買いシミュレーター"
        description="入力、株価シナリオ、建玉比較を先に操作できます。計算は概算です。"
        actions={(
          <>
            <HeaderPill label="買建専用" tone="blue" />
            <HeaderPill label="信用リスク注意" tone="red" />
          </>
        )}
      />

      <section className="grid gap-5 xl:grid-cols-[430px_1fr]">
        <div className="rounded-2xl border border-sky-300/20 bg-slate-900/82 p-5 shadow-xl shadow-black/25 ring-1 ring-white/5">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-300">Realtime AI Search</p>
          <h3 className="mt-2 text-xl font-black text-slate-50">銘柄検索とAIエントリー判定</h3>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            国内株と米国株を切り替えて検索できます。株価データは {stockDataProviderPriorityLabel} の順で取得します。
          </p>
          <div className="mt-4 grid gap-3">
            <div>
              <span className="text-xs font-semibold text-slate-400">市場</span>
              <div className="mt-1 grid grid-cols-2 overflow-hidden rounded-xl border border-white/10 bg-slate-950 p-1">
                {([
                  ["us", "米国株"],
                  ["jp", "国内株"]
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={`rounded-lg px-3 py-2 text-sm font-black transition ${
                      searchMarket === value
                        ? "bg-sky-300 text-slate-950 shadow-lg shadow-sky-950/30"
                        : "text-slate-400 hover:bg-white/5 hover:text-slate-100"
                    }`}
                    onClick={() => {
                      setSearchMarket(value);
                      setTicker(value === "jp" ? "7203" : "RGTI");
                      setSearchResult(null);
                      setSearchError("");
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <label>
              <span className="text-xs font-semibold text-slate-400">Ticker</span>
              <input
                className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2.5 text-sm font-bold uppercase text-slate-50 outline-none focus:border-sky-300/50"
                value={ticker}
                onChange={(event) => setTicker(event.target.value.toUpperCase())}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void searchTicker();
                }}
                placeholder={searchMarket === "jp" ? "7203 / 6758 / 9984" : "RGTI / SIDU / TSLA"}
              />
              <span className="mt-1 block text-[11px] leading-5 text-slate-500">
                {searchMarket === "jp" ? "国内株は4桁コードで入力できます。例: 7203 は 7203.T として取得します。" : "米国株はティッカーをそのまま入力します。例: RGTI / TSLA / NVDA"}
              </span>
            </label>
            <label>
              <span className="text-xs font-semibold text-slate-400">判定モード</span>
              <select
                className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2.5 text-sm font-semibold text-slate-50 outline-none focus:border-sky-300/50"
                value={tradeSide}
                onChange={(event) => setTradeSide(event.target.value as TradeSide)}
              >
                <option value="auto">AIに信用買い/信用売り/見送りを判定させる</option>
                <option value="margin_buy">信用買い前提で判定</option>
                <option value="short_sell">信用売り前提で判定</option>
              </select>
            </label>
            <button
              className="rounded-xl bg-sky-400 px-4 py-2.5 text-sm font-black text-slate-950 shadow-lg shadow-sky-950/30 transition hover:bg-sky-300 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={searchStatus === "running"}
              onClick={() => void searchTicker()}
            >
              {searchStatus === "running" ? "AI分析中..." : "銘柄を検索してAI判定"}
            </button>
            {searchError ? <p className="rounded-xl border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-200">{searchError}</p> : null}
          </div>
        </div>

        {searchResult ? (
          <div className="rounded-2xl border border-white/10 bg-slate-900/82 p-5 shadow-xl shadow-black/25 ring-1 ring-white/5">
            <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-sky-300/30 bg-sky-300/10 px-3 py-1 text-xs font-black text-sky-200">{searchResult.stock.ticker}</span>
                  <span className="rounded-full border border-amber-300/25 bg-amber-300/10 px-3 py-1 text-xs font-semibold text-amber-100">{isJapaneseTicker(searchResult.stock.ticker) ? "国内株" : "米国株"}</span>
                  <span className="rounded-full border border-white/10 bg-slate-950/70 px-3 py-1 text-xs font-semibold text-slate-300">{searchResult.mode === "live" ? "Live API" : "Local Data"}</span>
                  <span className={`rounded-full px-3 py-1 text-xs font-black ring-1 ${entryTone(searchResult.entryPlan.side)}`}>{searchResult.entryPlan.side}</span>
                </div>
                <h3 className="mt-3 text-2xl font-black text-slate-50">{searchResult.stock.companyName}</h3>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">{searchResult.entryPlan.summary}</p>
              </div>
              <button
                className="rounded-xl border border-amber-300/30 bg-amber-300/10 px-4 py-2 text-sm font-bold text-amber-100 hover:bg-amber-300/15 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-slate-800/60 disabled:text-slate-500"
                disabled={!isBuyCandidate || !isJapaneseTicker(searchResult.stock.ticker)}
                onClick={applySearchPriceToSimulator}
              >
                {isBuyCandidate && isJapaneseTicker(searchResult.stock.ticker) ? "価格を下の信用買い計算へ反映" : isBuyCandidate ? "米国株は円建て計算へ反映不可" : isShortCandidate ? "信用売りは下の買建計算へ反映不可" : "見送り判定は反映不可"}
              </button>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <AiMetric label="現在値" value={formatMarketPrice(searchResult.stock.ticker, searchResult.price.close)} tone="text-slate-50" />
              <AiMetric label="前日比" value={`${searchResult.price.changePercent >= 0 ? "+" : ""}${searchResult.price.changePercent.toFixed(2)}%`} tone={searchResult.price.changePercent >= 0 ? "text-sky-300" : "text-red-300"} />
              <AiMetric label="AIスコア" value={`${searchResult.score}/100`} tone={searchResult.score >= 65 ? "text-green-300" : searchResult.score >= 50 ? "text-yellow-200" : "text-red-300"} />
              <AiMetric label="利確到達率目安" value={`${searchResult.entryPlan.takeProfitProbability}%`} tone="text-green-300" />
              <AiMetric label="信頼度" value={`${searchResult.entryPlan.confidence}%`} tone="text-sky-200" />
              <AiMetric label={isShortCandidate ? "利確目安（買戻し）" : "利確目安"} value={formatMarketPrice(searchResult.stock.ticker, searchResult.entryPlan.takeProfitPrice)} tone="text-green-300" />
              <AiMetric label={isShortCandidate ? "損切り目安（踏み上げ）" : "損切り目安"} value={formatMarketPrice(searchResult.stock.ticker, searchResult.entryPlan.stopLossPrice)} tone="text-red-300" />
              <AiMetric label="Risk/Reward" value={`${searchResult.entryPlan.riskReward.toFixed(2)}x`} tone="text-amber-200" />
              <AiMetric label="RSI" value={searchResult.price.rsi.toFixed(1)} tone={searchResult.price.rsi >= 70 ? "text-yellow-200" : "text-slate-100"} />
              <AiMetric label="出来高倍率" value={`${searchResult.price.volumeRatio.toFixed(2)}x`} tone="text-slate-100" />
            </div>

            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <ReasonPanel title="判定根拠" items={searchResult.entryPlan.reasons} tone="sky" />
              <ReasonPanel title="注意点" items={searchResult.entryPlan.cautions} tone="red" />
            </div>
            {searchResult.warning ? (
              <p className="mt-4 rounded-xl border border-yellow-300/25 bg-yellow-300/10 p-3 text-sm text-yellow-100">{searchResult.warning}</p>
            ) : null}
            {isShortCandidate ? (
              <p className="mt-4 rounded-xl border border-red-400/25 bg-red-400/10 p-3 text-sm leading-6 text-red-100">
                信用売り候補では、利確は現在値より下、損切りは現在値より上として表示しています。下のExcel計算パネルは信用買い専用のため、この信用売り判定は反映しません。
              </p>
            ) : null}
            <p className="mt-3 text-xs leading-5 text-slate-500">
              国内株は円、米国株はドルで表示します。下の信用買いExcel計算は円建ての買建専用なので、米国株は為替と証券会社の信用取引対象を別途確認してください。
            </p>
          </div>
        ) : (
          <div className="rounded-2xl border border-white/10 bg-slate-900/55 p-5 text-sm leading-6 text-slate-400 ring-1 ring-white/5">
            銘柄を検索すると、直近価格、RSI、MA20/MA50、出来高倍率、AIエントリー判定、利確到達率目安、信用買い/信用売り/見送り判定がここに表示されます。
          </div>
        )}
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="最大株数" value={`${num(summary.maxShares)}株`} tone="blue" />
        <StatCard label="建玉金額" value={yen(summary.positionValue)} tone="default" />
        <StatCard label="追証ライン目安" value={price(summary.marginCallPrice)} tone="yellow" />
        <StatCard label="10%ライン目安" value={price(summary.dangerPrice)} tone="red" />
      </section>

      <section className="grid gap-5 xl:grid-cols-[420px_1fr]">
        <div className="rounded-2xl border border-white/10 bg-slate-900/82 p-5 shadow-xl shadow-black/25 ring-1 ring-white/5">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-lg font-bold text-slate-50">入力・前提</h3>
            <button
              className="rounded-full border border-white/10 bg-slate-950/70 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-800"
              onClick={resetInputs}
            >
              初期値に戻す
            </button>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
            {inputRows.map((row) => (
              <label key={row.key} className="block">
                <span className="text-xs font-semibold text-slate-400">{row.label}</span>
                <div className="mt-1 flex overflow-hidden rounded-xl border border-white/10 bg-slate-950 focus-within:border-sky-300/50">
                  <input
                    className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-sm font-semibold text-slate-50 outline-none"
                    type="number"
                    step={row.step ?? "1"}
                    value={inputDraft[row.key]}
                    onChange={(event) => updateInput(row.key, event.target.value)}
                  />
                  <span className="border-l border-white/10 px-3 py-2.5 text-xs font-semibold text-slate-500">{row.suffix}</span>
                </div>
              </label>
            ))}
          </div>
        </div>

        <div className="space-y-5 min-w-0">
          <div className="overflow-hidden rounded-3xl border border-white/10 bg-[#0b1120] shadow-2xl shadow-black/30 ring-1 ring-white/5">
            <div className="flex flex-col justify-between gap-3 md:flex-row md:items-end">
              <div className="p-5 pb-0">
                <p className="text-xs font-black uppercase tracking-[0.20em] text-[#b892ff]">Scenario Chart</p>
                <h3 className="mt-1 text-xl font-black text-slate-50">株価シナリオ</h3>
                <p className="mt-1 text-sm text-slate-400">株価ごとの決済後手取り損益と危険ラインを確認します。</p>
              </div>
              <div className="grid grid-cols-2 gap-2 p-5 pb-0 text-xs sm:flex">
                <span className="rounded-full bg-green-400/15 px-3 py-1.5 font-semibold text-green-200">利確 {price(targetScenario.price)}</span>
                <span className="rounded-full bg-red-400/15 px-3 py-1.5 font-semibold text-red-200">損切り {price(stopScenario.price)}</span>
              </div>
            </div>
            <div className="m-3 mt-4 h-[330px] min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-[radial-gradient(circle_at_20%_0%,rgba(111,45,168,0.22),transparent_34%),linear-gradient(180deg,#111827,#0b1120)] p-2 sm:m-5 sm:h-[390px] sm:p-4">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={scenarios} margin={{ left: 0, right: 14, top: 14, bottom: 4 }}>
                  <defs>
                    <linearGradient id="profit" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0%" stopColor="#00c805" stopOpacity={0.36} />
                      <stop offset="52%" stopColor="#00c805" stopOpacity={0.10} />
                      <stop offset="100%" stopColor="#00c805" stopOpacity={0.01} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="rgba(148,163,184,0.13)" vertical={false} />
                  <XAxis dataKey="price" tick={{ fill: "#94a3b8", fontSize: 11, fontWeight: 600 }} tickLine={false} axisLine={{ stroke: "rgba(148,163,184,0.20)" }} />
                  <YAxis orientation="right" tick={{ fill: "#94a3b8", fontSize: 11, fontWeight: 600 }} tickLine={false} axisLine={false} width={74} tickFormatter={(value) => `${Math.round(Number(value) / 1000)}千`} />
                  <Tooltip
                    cursor={{ stroke: "rgba(255,255,255,0.28)", strokeDasharray: "4 4" }}
                    contentStyle={{ background: "#0f172a", border: "1px solid rgba(148,163,184,0.30)", borderRadius: 14, color: "#f8fafc", boxShadow: "0 18px 36px rgba(0,0,0,0.35)" }}
                    formatter={(value, name) => [yen(Number(value)), name === "netPnl" ? "手取り損益" : String(name)]}
                    labelFormatter={(value) => `株価 ${value}円`}
                  />
                  <ReferenceLine x={inputs.buyPrice} stroke="#60a5fa" strokeDasharray="4 6" />
                  <ReferenceLine x={summary.marginCallPrice} stroke="#facc15" strokeDasharray="4 6" />
                  <ReferenceLine x={summary.dangerPrice} stroke="#ff3b30" strokeDasharray="4 6" />
                  <ReferenceLine y={0} stroke="rgba(203,213,225,0.55)" strokeDasharray="5 6" />
                  <Area type="monotone" dataKey="netPnl" stroke="#00c805" strokeWidth={3.2} fill="url(#profit)" dot={false} activeDot={{ r: 5, fill: "#00c805", stroke: "#0f172a", strokeWidth: 2 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
            <MetricCard label="新規建直後の余力" value={yen(summary.afterEntryCash)} tone={summary.afterEntryCash < 200000 ? "text-yellow-200" : "text-green-300"} />
            <MetricCard label="目標時 税引前利益" value={yen(summary.targetGrossProfit)} tone="text-green-300" />
            <MetricCard label="目標時 手取り概算" value={yen(summary.targetNetProfit)} tone="text-sky-200" />
            <MetricCard label="損切り時 税前損益" value={yen(summary.stopLossPnl)} tone="text-red-300" />
            <MetricCard label="概算買方金利" value={yen(summary.interestCost)} tone="text-amber-200" />
            <MetricCard label="税金概算" value={yen(summary.taxCost)} tone="text-slate-200" />
            <MetricCard label="6ヶ月概算金利" value={yen(summary.expiryInterestCost)} tone="text-amber-200" />
            <MetricCard label="6ヶ月後 追証ライン" value={price(summary.expiryMarginCallPrice)} tone="text-yellow-200" />
          </div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="space-y-3 min-w-0">
          <SectionTitle title="株価シナリオ表" subtitle="Excelの状態判定に合わせて、追証・10%割れ候補を強調します。" />
          <DataTable
            headers={["株価", "評価損益", "手取り損益", "保証金率", "状態", "追証不足目安"]}
            rows={scenarios.map((item) => [
              <span key="price">{price(item.price)}</span>,
              <span key="unrealized" className={item.unrealizedPnl >= 0 ? "text-green-300" : "text-red-300"}>{yen(item.unrealizedPnl)}</span>,
              <span key="net" className={item.netPnl >= 0 ? "text-green-300" : "text-red-300"}>{yen(item.netPnl)}</span>,
              <span key="ratio" className={item.marginRatio < inputs.maintenanceRate ? "font-bold text-yellow-200" : "text-slate-200"}>{pct(item.marginRatio)}</span>,
              <span key="status" className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ring-1 ${scenarioTone(item.status)}`}>{item.status}</span>,
              <span key="shortfall" className={item.marginShortfall > 0 ? "font-bold text-red-300" : "text-slate-400"}>{yen(item.marginShortfall)}</span>
            ])}
          />
        </div>

        <div className="space-y-3 min-w-0">
          <SectionTitle title="建玉比較" subtitle="全力ではなく株数を抑えた場合の余力と追証ラインです。" />
          <DataTable
            headers={["株数", "必要保証金", "建直後余力", "手取り概算", "追証ライン", "リスク感"]}
            rows={comparisons.map((item) => [
              <span key="shares">{num(item.shares)}株</span>,
              <span key="required">{yen(item.requiredMargin)}</span>,
              <span key="cash" className={item.afterEntryCash < 200000 ? "text-yellow-200" : "text-green-300"}>{yen(item.afterEntryCash)}</span>,
              <span key="net" className={item.targetNetProfit >= 0 ? "text-green-300" : "text-red-300"}>{yen(item.targetNetProfit)}</span>,
              <span key="line">{price(item.marginCallPrice)}</span>,
              <span key="risk" className={`font-bold ${riskTone(item.riskLabel)}`}>{item.riskLabel}</span>
            ])}
          />
          <div className="rounded-2xl border border-white/10 bg-slate-900/82 p-5 text-sm leading-6 text-slate-300 shadow-xl shadow-black/25 ring-1 ring-white/5">
            <h3 className="text-base font-bold text-slate-50">注文前チェック</h3>
            <ul className="mt-3 space-y-2">
              <li>この下の計算は「信用新規買い」から「返済売り」までの買建専用です。信用売りのAI判定とは計算方向が逆です。</li>
              <li>IFOを使う場合は、利確価格 {price(inputs.targetPrice)} と損切り価格 {price(inputs.stopLossPrice)} を事前に確認してください。</li>
              <li>追証ラインは概算 {price(summary.marginCallPrice)}、10%ラインは概算 {price(summary.dangerPrice)} です。</li>
              <li>売買停止、ストップ安、板が薄い場合は希望価格で約定しない可能性があります。</li>
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}

function MetricCard({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/55 p-4 shadow-lg shadow-black/15 ring-1 ring-white/5">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p className={`mt-2 text-xl font-black tracking-tight ${tone}`}>{value}</p>
    </div>
  );
}

function AiMetric({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/55 p-4 ring-1 ring-white/5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p className={`mt-2 text-xl font-black tracking-tight ${tone}`}>{value}</p>
    </div>
  );
}

function ReasonPanel({ title, items, tone }: { title: string; items: string[]; tone: "sky" | "red" }) {
  const style = tone === "sky" ? "border-sky-300/20 bg-sky-300/5 text-sky-100" : "border-red-400/20 bg-red-400/5 text-red-100";
  return (
    <div className={`rounded-2xl border p-4 ${style}`}>
      <h4 className="text-sm font-black text-slate-50">{title}</h4>
      <ul className="mt-3 space-y-2 text-sm leading-6">
        {items.map((item) => (
          <li key={item} className="break-words">{item}</li>
        ))}
      </ul>
    </div>
  );
}

function entryTone(side: StockSearchResult["entryPlan"]["side"]) {
  if (side === "信用買い候補") return "bg-green-400/15 text-green-200 ring-green-400/30";
  if (side === "信用売り候補") return "bg-red-400/15 text-red-200 ring-red-400/30";
  return "bg-yellow-300/15 text-yellow-100 ring-yellow-300/30";
}

function SectionTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <h3 className="text-lg font-bold text-slate-50">{title}</h3>
      <p className="mt-1 text-sm text-slate-400">{subtitle}</p>
    </div>
  );
}
