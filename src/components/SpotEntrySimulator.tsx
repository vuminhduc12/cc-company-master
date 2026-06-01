"use client";

import { useEffect, useMemo, useState } from "react";
import { DataTable } from "@/components/DataTable";
import {
  accountTypeLabel,
  calculateSpotSimulation,
  JAPAN_CAPITAL_GAINS_TAX_RATE,
  type SpotAccountType,
  type SpotScenario,
  type SpotSimulationInput
} from "@/lib/spot-simulator";
import type { DailyPrice, NewsItem, Stock } from "@/types";

type AiRiskComment = {
  summary: string;
  dataFreshness?: string;
  riskLevel: "低" | "中" | "高";
  confidence?: "低" | "中" | "高";
  entryPriceComment?: string;
  positionSizeComment: string;
  exitPlanComment: string;
  taxComment: string;
  fxComment?: string;
  technicalComment?: string;
  newsComment: string;
  stressTest?: string[];
  blindSpots?: string[];
  checklist: string[];
};

type Props = {
  stock: Stock;
  price: DailyPrice;
  news: NewsItem[];
  score: number;
};

const accountTypes: SpotAccountType[] = ["taxable", "general", "nisa"];

export function SpotEntrySimulator({ stock, price, news, score }: Props) {
  const currency = stock.ticker.endsWith(".T") || stock.exchange.toUpperCase().includes("TSE") ? "JPY" : "USD";
  const [shares, setShares] = useState("100");
  const [entryPrice, setEntryPrice] = useState(price.close.toFixed(2));
  const [takeProfitPercent, setTakeProfitPercent] = useState("10");
  const [stopLossPercent, setStopLossPercent] = useState("-8");
  const [accountType, setAccountType] = useState<SpotAccountType>("taxable");
  const [feeJpy, setFeeJpy] = useState("0");
  const [fxRate, setFxRate] = useState("156");
  const [fxSource, setFxSource] = useState("手入力");
  const [fxAsOf, setFxAsOf] = useState("");
  const [aiComment, setAiComment] = useState<AiRiskComment | null>(null);
  const [aiStatus, setAiStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [aiMode, setAiMode] = useState<"normal" | "detailed">("normal");
  const [aiError, setAiError] = useState("");

  const input: SpotSimulationInput = useMemo(() => ({
    currency,
    shares: parseNumericInput(shares, 0),
    entryPrice: parseNumericInput(entryPrice, price.close),
    takeProfitPercent: parseNumericInput(takeProfitPercent, 10),
    stopLossPercent: parseNumericInput(stopLossPercent, -8),
    accountType,
    feeJpy: parseNumericInput(feeJpy, 0),
    fxRate: parseNumericInput(fxRate, 156),
    taxRate: JAPAN_CAPITAL_GAINS_TAX_RATE
  }), [accountType, currency, entryPrice, feeJpy, fxRate, price.close, shares, stopLossPercent, takeProfitPercent]);

  const simulation = useMemo(() => calculateSpotSimulation(input), [input]);
  const recentNews = news.slice(0, 5);

  useEffect(() => {
    if (currency !== "USD") return;
    let ignore = false;

    async function loadFxRate() {
      try {
        const response = await fetch("/api/fx/usd-jpy");
        if (!response.ok) throw new Error("FX fetch failed");
        const data = await response.json();
        if (!ignore && data.ok && Number.isFinite(data.rate)) {
          setFxRate(Number(data.rate).toFixed(2));
          setFxSource(data.source ?? "自動取得");
          setFxAsOf(data.asOf ?? "");
        }
      } catch {
        if (!ignore) {
          setFxSource("手入力");
          setFxAsOf("");
        }
      }
    }

    loadFxRate();
    return () => {
      ignore = true;
    };
  }, [currency]);

  async function requestAiComment(diagnosisMode: "normal" | "detailed") {
    setAiStatus("loading");
    setAiMode(diagnosisMode);
    setAiError("");

    try {
      const response = await fetch("/api/spot-simulator/ai-comment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          diagnosisMode,
          stock,
          marketMetrics: {
            close: price.close,
            changePercent: price.changePercent,
            rsi: price.rsi,
            ma20: price.ma20,
            ma50: price.ma50,
            volumeRatio: price.volumeRatio,
            score
          },
          input,
          simulation,
          news: recentNews.map((item) => ({
            title: item.title,
            publishedAt: item.publishedAt,
            sentiment: item.sentiment,
            impactScore: item.impactScore,
            summary: item.summary
          }))
        })
      });

      if (!response.ok) throw new Error(`${diagnosisMode === "detailed" ? "AI詳細診断" : "AI診断"}に失敗しました (${response.status})`);
      const data = await response.json();
      setAiComment(data.analysis);
      setAiStatus("done");
    } catch (error) {
      setAiStatus("error");
      setAiError(error instanceof Error ? error.message : "AI診断に失敗しました");
    }
  }

  return (
    <section className="rounded-2xl border border-white/10 bg-slate-900/82 p-4 shadow-xl shadow-black/25 ring-1 ring-white/5 sm:p-5">
      <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-start">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-300">Cash Stock Simulator</p>
          <h3 className="mt-2 text-xl font-black text-slate-50">現物エントリー損益シミュレーション</h3>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
            今見ている銘柄を現在付近で買った前提で、利確・損切り・税金・為替換算後の手取りを計算します。信用シミュレーションとは独立した現物株専用の計算です。
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:min-w-[460px]">
          <SummaryTile label="投資額" value={formatMoney(simulation.positionValueJpy, "JPY")} />
          <SummaryTile label="利確手取り" value={formatSignedMoney(simulation.takeProfit.netPnlJpy)} tone={simulation.takeProfit.netPnlJpy >= 0 ? "up" : "down"} />
          <SummaryTile label="損切り損益" value={formatSignedMoney(simulation.stopLoss.netPnlJpy)} tone={simulation.stopLoss.netPnlJpy >= 0 ? "up" : "down"} />
          <SummaryTile label="R/R" value={simulation.riskReward ? simulation.riskReward.toFixed(2) : "-"} tone={simulation.riskReward && simulation.riskReward >= 1.5 ? "up" : "warn"} />
        </div>
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className="rounded-2xl border border-white/10 bg-slate-950/45 p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <NumberField label="株数" value={shares} onChange={setShares} min="0" step="1" />
            <NumberField label={`エントリー価格 (${currency})`} value={entryPrice} onChange={setEntryPrice} min="0" step={currency === "JPY" ? "1" : "0.01"} />
            <NumberField label="利確 %" value={takeProfitPercent} onChange={setTakeProfitPercent} step="0.5" />
            <NumberField label="損切り %" value={stopLossPercent} onChange={setStopLossPercent} step="0.5" />
            <NumberField label="手数料合計 円" value={feeJpy} onChange={setFeeJpy} min="0" step="100" />
            {currency === "USD" ? (
              <NumberField label="USD/JPY" value={fxRate} onChange={setFxRate} min="0" step="0.01" />
            ) : (
              <div className="rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2">
                <p className="text-[11px] font-semibold text-slate-500">通貨</p>
                <p className="mt-2 text-sm font-bold text-slate-100">円建て</p>
              </div>
            )}
          </div>

          <div className="mt-4">
            <p className="mb-2 text-[11px] font-semibold text-slate-500">口座区分</p>
            <div className="grid grid-cols-3 gap-2">
              {accountTypes.map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setAccountType(type)}
                  className={`h-10 rounded-xl border text-xs font-bold transition ${
                    accountType === type
                      ? "border-emerald-300/60 bg-emerald-300/15 text-emerald-100"
                      : "border-white/10 bg-white/5 text-slate-300 hover:border-emerald-300/35 hover:bg-emerald-300/10"
                  }`}
                >
                  {accountTypeLabel(type)}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-white/10 bg-slate-900/65 p-3 text-xs leading-5 text-slate-400">
            <p>税率: {accountType === "nisa" ? "0%" : `${(JAPAN_CAPITAL_GAINS_TAX_RATE * 100).toFixed(3)}%`} / 利益が出た場合のみ課税</p>
            {currency === "USD" ? <p className="mt-1">為替: {fxSource}{fxAsOf ? ` / ${formatDateTime(fxAsOf)}` : ""}</p> : null}
            {accountType === "nisa" ? <p className="mt-1 text-yellow-200">NISAは利益非課税ですが、損失の損益通算はできません。</p> : null}
          </div>
        </div>

        <div className="min-w-0 space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <MetricCard label="税金概算（利確）" value={formatMoney(simulation.takeProfit.taxJpy, "JPY")} />
            <MetricCard label="最大損失シナリオ" value={formatSignedMoney(simulation.maxLoss.netPnlJpy)} tone="down" />
            <MetricCard label="想定ポジション" value={currency === "USD" ? `${formatMoney(simulation.positionValueNative, "USD")} / ${formatMoney(simulation.positionValueJpy, "JPY")}` : formatMoney(simulation.positionValueJpy, "JPY")} />
          </div>

          <DataTable
            headers={["シナリオ", "価格", "税込前損益", "税金", "手取り損益", "手取り利回り", "判定"]}
            rows={simulation.scenarios.map((scenario) => [
              scenario.label,
              formatMoney(scenario.price, currency),
              currency === "USD"
                ? `${formatSignedNative(scenario.grossPnlNative, "USD")} / ${formatSignedMoney(scenario.grossPnlJpy)}`
                : formatSignedMoney(scenario.grossPnlJpy),
              formatMoney(scenario.taxJpy, "JPY"),
              <ScenarioMoney key="net" scenario={scenario} />,
              `${scenario.returnPercentAfterTax >= 0 ? "+" : ""}${scenario.returnPercentAfterTax.toFixed(2)}%`,
              <ScenarioStatus key="status" scenario={scenario} />
            ])}
          />

          <div className="rounded-2xl border border-emerald-300/20 bg-emerald-300/[0.06] p-4">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
              <div>
                <p className="text-sm font-bold text-emerald-100">AIリスク診断</p>
                <p className="mt-1 text-xs leading-5 text-slate-400">通常診断は低コストで要点確認、詳細診断は高精度モデルで前提崩れや見落としまで深掘りします。</p>
              </div>
              <div className="grid w-full gap-2 sm:w-auto sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => requestAiComment("normal")}
                  disabled={aiStatus === "loading"}
                  className="h-11 rounded-xl border border-emerald-300/45 bg-emerald-300/15 px-4 text-sm font-black text-emerald-50 transition hover:bg-emerald-300/25 disabled:cursor-wait disabled:opacity-60"
                >
                  {aiStatus === "loading" && aiMode === "normal" ? "診断中..." : "通常診断"}
                </button>
                <button
                  type="button"
                  onClick={() => requestAiComment("detailed")}
                  disabled={aiStatus === "loading"}
                  className="h-11 rounded-xl border border-amber-300/45 bg-amber-300/15 px-4 text-sm font-black text-amber-50 transition hover:bg-amber-300/25 disabled:cursor-wait disabled:opacity-60"
                >
                  {aiStatus === "loading" && aiMode === "detailed" ? "詳細診断中..." : "詳細診断"}
                </button>
              </div>
            </div>
            <p className="mt-3 text-[11px] leading-5 text-slate-500">詳細診断は高精度モデルを使うため、通常診断よりAPIコストが高くなります。</p>
            {aiStatus === "error" ? <p className="mt-3 text-sm text-red-200">{aiError}</p> : null}
            {aiComment ? <AiCommentPanel comment={aiComment} mode={aiMode} /> : null}
          </div>
        </div>
      </div>
    </section>
  );
}

function NumberField({ label, value, onChange, min, step = "1" }: { label: string; value: string; onChange: (value: string) => void; min?: string; step?: string }) {
  return (
    <label className="block rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 focus-within:border-emerald-300/55 focus-within:bg-slate-900">
      <span className="block text-[11px] font-semibold text-slate-500">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        step={step}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 block h-8 w-full min-w-0 appearance-auto bg-transparent text-base font-bold text-slate-100 outline-none"
      />
    </label>
  );
}

function SummaryTile({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "up" | "down" | "warn" }) {
  const color = toneColor(tone);
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-3">
      <p className="text-[11px] font-semibold text-slate-500">{label}</p>
      <p className={`mt-2 break-words text-base font-black tabular-nums sm:text-lg ${color}`}>{value}</p>
    </div>
  );
}

function MetricCard({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "up" | "down" | "warn" }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/45 p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <p className={`mt-2 break-words text-base font-black tabular-nums ${toneColor(tone)}`}>{value}</p>
    </div>
  );
}

function ScenarioMoney({ scenario }: { scenario: SpotScenario }) {
  return <span className={scenario.netPnlJpy >= 0 ? "font-bold text-sky-300" : "font-bold text-red-300"}>{formatSignedMoney(scenario.netPnlJpy)}</span>;
}

function ScenarioStatus({ scenario }: { scenario: SpotScenario }) {
  const className = scenario.status === "利確ライン"
    ? "border-sky-300/40 bg-sky-300/15 text-sky-200"
    : scenario.status === "損切りライン"
      ? "border-red-400/40 bg-red-400/15 text-red-200"
      : scenario.netPnlJpy > 0
        ? "border-emerald-300/40 bg-emerald-300/15 text-emerald-200"
        : scenario.netPnlJpy < 0
          ? "border-yellow-300/40 bg-yellow-300/10 text-yellow-200"
          : "border-slate-400/30 bg-slate-400/10 text-slate-300";

  return <span className={`inline-flex min-w-20 justify-center rounded-full border px-2.5 py-1 text-xs font-bold ${className}`}>{scenario.status}</span>;
}

function AiCommentPanel({ comment, mode }: { comment: AiRiskComment; mode: "normal" | "detailed" }) {
  const riskClass = comment.riskLevel === "高"
    ? "border-red-400/40 bg-red-400/15 text-red-100"
    : comment.riskLevel === "中"
      ? "border-yellow-300/40 bg-yellow-300/15 text-yellow-100"
      : "border-emerald-300/40 bg-emerald-300/15 text-emerald-100";

  return (
    <div className="mt-4 border-t border-white/10 pt-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-bold text-slate-400">{mode === "detailed" ? "詳細診断" : "通常診断"}</p>
          <p className="mt-1 text-sm leading-6 text-slate-200">{comment.summary}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <span className={`inline-flex justify-center rounded-full border px-3 py-1 text-xs font-black ${riskClass}`}>リスク {comment.riskLevel}</span>
          {comment.confidence ? <span className="inline-flex justify-center rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-black text-slate-200">信頼度 {comment.confidence}</span> : null}
        </div>
      </div>
      {comment.dataFreshness ? (
        <div className="mt-3 rounded-xl border border-white/10 bg-slate-950/45 p-3">
          <p className="text-xs font-bold text-slate-300">データ取得時点</p>
          <p className="mt-1 text-xs leading-5 text-slate-400">{comment.dataFreshness}</p>
        </div>
      ) : null}
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {comment.entryPriceComment ? <AiText label="エントリー価格" value={comment.entryPriceComment} /> : null}
        <AiText label="サイズ" value={comment.positionSizeComment} />
        <AiText label="出口計画" value={comment.exitPlanComment} />
        <AiText label="税金" value={comment.taxComment} />
        {comment.fxComment ? <AiText label="為替" value={comment.fxComment} /> : null}
        {comment.technicalComment ? <AiText label="テクニカル" value={comment.technicalComment} /> : null}
        <AiText label="ニュース" value={comment.newsComment} />
      </div>
      {comment.stressTest?.length ? <AiList title="ストレステスト" items={comment.stressTest} /> : null}
      {comment.blindSpots?.length ? <AiList title="見落とし確認" items={comment.blindSpots} /> : null}
      <div className="mt-3 rounded-xl border border-white/10 bg-slate-950/45 p-3">
        <p className="text-xs font-bold text-slate-300">確認チェックリスト</p>
        <ul className="mt-2 space-y-1 text-xs leading-5 text-slate-400">
          {comment.checklist.map((item) => <li key={item}>・{item}</li>)}
        </ul>
      </div>
    </div>
  );
}

function AiList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="mt-3 rounded-xl border border-white/10 bg-slate-950/45 p-3">
      <p className="text-xs font-bold text-slate-300">{title}</p>
      <ul className="mt-2 space-y-1 text-xs leading-5 text-slate-400">
        {items.map((item) => <li key={item}>・{item}</li>)}
      </ul>
    </div>
  );
}

function AiText({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-slate-950/45 p-3">
      <p className="text-xs font-bold text-slate-300">{label}</p>
      <p className="mt-1 text-xs leading-5 text-slate-400">{value}</p>
    </div>
  );
}

function toneColor(tone: "default" | "up" | "down" | "warn") {
  return {
    default: "text-slate-50",
    up: "text-sky-300",
    down: "text-red-300",
    warn: "text-yellow-300"
  }[tone];
}

function formatMoney(value: number, currency: "USD" | "JPY") {
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "JPY" ? 0 : 2
  }).format(value || 0);
}

function formatSignedMoney(value: number) {
  const formatted = formatMoney(Math.abs(value), "JPY");
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `-${formatted}`;
  return formatted;
}

function formatSignedNative(value: number, currency: "USD" | "JPY") {
  const formatted = formatMoney(Math.abs(value), currency);
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `-${formatted}`;
  return formatted;
}

function parseNumericInput(value: string, fallback: number) {
  if (value === "" || value === "-" || value === "." || value === "-.") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}
