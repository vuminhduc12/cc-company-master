"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { DataTable } from "@/components/DataTable";
import {
  clearAiDiagnosisHistoryForTicker,
  deleteAiDiagnosisHistoryItem,
  loadAiDiagnosisHistory,
  saveAiDiagnosisHistory,
  type AiDiagnosisHistoryItem
} from "@/lib/ai-diagnosis-history";
import { authHeaders } from "@/lib/auth-fetch";
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
  irView?: string;
  balanceSheetView?: string;
  incomeStatementView?: string;
  businessValueView?: string;
  marketView?: {
    scenario: "upside" | "range" | "downside";
    confidence: "低" | "中" | "高";
    topEvidence: string[];
  };
  historicalPatternView?: string;
  newsImpactView?: string;
  macroImpactView?: string;
  largeMoneyFlowView?: string;
  scenarioForecast?: {
    oneToTwoWeeks: string;
    oneToThreeMonths: string;
    upsideTrigger: string;
    downsideInvalidation: string;
    dangerLevel: string;
  };
  riskFilter?: string;
  analystView?: string;
  scenarioPrediction?: string;
  userQuestionAnswer?: string;
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
const aiQuestionExamples = [
  "今後1〜2週間で上に行く条件と下に崩れる条件は？",
  "今この価格付近で入る場合、一番危ないリスクは？",
  "1〜3か月で伸びる可能性と、その前提が崩れる条件は？"
];

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
  const [aiRequestHasQuestion, setAiRequestHasQuestion] = useState(false);
  const [aiRuntime, setAiRuntime] = useState<{ mode: "ai" | "rule"; model?: string; warning?: string; cached?: boolean } | null>(null);
  const [aiError, setAiError] = useState("");
  const [aiQuestion, setAiQuestion] = useState("");
  const [aiHistory, setAiHistory] = useState<AiDiagnosisHistoryItem[]>([]);

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

  useEffect(() => {
    setAiHistory(loadAiDiagnosisHistory(stock.ticker));
  }, [stock.ticker]);

  async function requestAiComment(diagnosisMode: "normal" | "detailed", question = "") {
    setAiStatus("loading");
    setAiMode(diagnosisMode);
    setAiRuntime(null);
    setAiError("");
    const trimmedQuestion = question.trim();
    setAiRequestHasQuestion(Boolean(trimmedQuestion));

    try {
      const response = await fetch("/api/spot-simulator/ai-comment", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...await authHeaders() },
        body: JSON.stringify({
          diagnosisMode,
          userQuestion: trimmedQuestion || undefined,
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
      const runtime = {
        mode: data.mode === "ai" ? "ai" : "rule",
        model: typeof data.model === "string" ? data.model : undefined,
        warning: typeof data.warning === "string" ? data.warning : undefined,
        cached: Boolean(data.cached)
      } as const;
      setAiComment(data.analysis);
      setAiRuntime(runtime);
      setAiHistory(saveAiDiagnosisHistory({
        id: createHistoryId(stock.ticker),
        ticker: stock.ticker,
        companyName: stock.companyName,
        createdAt: new Date().toISOString(),
        diagnosisMode,
        question: trimmedQuestion || undefined,
        runtime,
        comment: data.analysis,
        input,
        quote: {
          price: price.close,
          date: price.date,
          changePercent: price.changePercent
        }
      }));
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
                <p className="mt-1 text-xs leading-5 text-slate-400">固定診断に加えて、今後の動き・危険ライン・入る前提の弱点を質問できます。回答はBuffett型の元本保全ルールと現在データに基づきます。</p>
              </div>
              <div className="grid w-full gap-2 sm:w-auto sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => requestAiComment("normal")}
                  disabled={aiStatus === "loading"}
                  className="h-11 rounded-xl border border-emerald-300/45 bg-emerald-300/15 px-4 text-sm font-black text-emerald-50 transition hover:bg-emerald-300/25 disabled:cursor-wait disabled:opacity-60"
                >
                  {aiStatus === "loading" && aiMode === "normal" && !aiRequestHasQuestion ? "診断中..." : "通常診断"}
                </button>
                <button
                  type="button"
                  onClick={() => requestAiComment("detailed")}
                  disabled={aiStatus === "loading"}
                  className="h-11 rounded-xl border border-amber-300/45 bg-amber-300/15 px-4 text-sm font-black text-amber-50 transition hover:bg-amber-300/25 disabled:cursor-wait disabled:opacity-60"
                >
                  {aiStatus === "loading" && aiMode === "detailed" && !aiRequestHasQuestion ? "詳細診断中..." : "詳細診断"}
                </button>
              </div>
            </div>
            <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/45 p-3">
              <label className="block">
                <span className="text-xs font-bold text-slate-300">AIに質問</span>
                <textarea
                  value={aiQuestion}
                  onChange={(event) => setAiQuestion(event.target.value)}
                  rows={3}
                  maxLength={600}
                  placeholder={`${stock.ticker}の今後の動き、危険ライン、入るなら何を確認すべきか質問できます`}
                  className="mt-2 block w-full resize-none rounded-xl border border-white/10 bg-slate-950/70 px-3 py-3 text-sm leading-6 text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-sky-300/55 focus:bg-slate-950"
                />
              </label>
              <div className="mt-3 flex flex-wrap gap-2">
                {aiQuestionExamples.map((example) => (
                  <button
                    key={example}
                    type="button"
                    onClick={() => setAiQuestion(example)}
                    className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] font-bold text-slate-300 transition hover:border-sky-300/35 hover:bg-sky-300/10 hover:text-sky-100"
                  >
                    {example}
                  </button>
                ))}
              </div>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-[11px] leading-5 text-slate-500">質問ありの場合は詳細診断として、Rule 1/2/3、テクニカル、ニュース、過去類似パターンから条件付きで回答します。</p>
                <button
                  type="button"
                  onClick={() => requestAiComment("detailed", aiQuestion)}
                  disabled={aiStatus === "loading" || !aiQuestion.trim()}
                  className="h-11 rounded-xl border border-sky-300/45 bg-sky-300/15 px-4 text-sm font-black text-sky-50 transition hover:bg-sky-300/25 disabled:cursor-not-allowed disabled:opacity-50 sm:min-w-40"
                >
                  {aiStatus === "loading" && aiRequestHasQuestion ? "回答中..." : "質問して分析"}
                </button>
              </div>
            </div>
            <p className="mt-3 text-[11px] leading-5 text-slate-500">詳細診断と質問回答は高精度モデルを使うため、通常診断よりAPIコストが高くなります。</p>
            {aiStatus === "error" ? <p className="mt-3 text-sm text-red-200">{aiError}</p> : null}
            {aiComment ? <AiCommentPanel comment={aiComment} mode={aiMode} runtime={aiRuntime} /> : null}
            <AiDiagnosisHistoryPanel
              ticker={stock.ticker}
              items={aiHistory}
              onSelect={(item) => {
                setAiComment(item.comment as AiRiskComment);
                setAiMode(item.diagnosisMode);
                setAiRuntime(item.runtime);
                setAiRequestHasQuestion(Boolean(item.question));
                setAiQuestion(item.question ?? "");
              }}
              onDelete={(id) => setAiHistory(deleteAiDiagnosisHistoryItem(id, stock.ticker))}
              onClear={() => setAiHistory(clearAiDiagnosisHistoryForTicker(stock.ticker))}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function AiDiagnosisHistoryPanel({
  ticker,
  items,
  onSelect,
  onDelete,
  onClear
}: {
  ticker: string;
  items: AiDiagnosisHistoryItem[];
  onSelect: (item: AiDiagnosisHistoryItem) => void;
  onDelete: (id: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/45 p-4">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <p className="text-sm font-bold text-slate-100">AI診断履歴</p>
          <p className="mt-1 text-xs leading-5 text-slate-500">{ticker}の質問・診断・使用モデル・データ鮮度を保存します。最大30件まで保持します。</p>
        </div>
        {items.length ? (
          <button
            type="button"
            onClick={onClear}
            className="w-fit rounded-xl border border-red-300/25 bg-red-300/10 px-3 py-2 text-xs font-black text-red-100 transition hover:bg-red-300/20"
          >
            履歴を全削除
          </button>
        ) : null}
      </div>
      {items.length ? (
        <div className="mt-4 space-y-2">
          {items.map((item) => (
            <div key={item.id} className="rounded-xl border border-white/10 bg-slate-900/70 p-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <button type="button" onClick={() => onSelect(item)} className="min-w-0 text-left">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-black text-slate-300">{item.diagnosisMode === "detailed" ? "詳細" : "通常"}</span>
                    <span className={item.runtime.mode === "ai" ? "rounded-full border border-sky-300/35 bg-sky-300/10 px-2 py-0.5 text-[10px] font-black text-sky-100" : "rounded-full border border-yellow-300/35 bg-yellow-300/10 px-2 py-0.5 text-[10px] font-black text-yellow-100"}>
                      {item.runtime.mode === "ai" ? `AI${item.runtime.model ? ` / ${item.runtime.model}` : ""}` : "Rule"}
                    </span>
                    <span className="text-[11px] font-bold text-slate-500">{formatDateTime(item.createdAt)}</span>
                  </div>
                  <p className="mt-2 line-clamp-2 text-sm font-bold leading-5 text-slate-200">{item.question || item.comment.summary}</p>
                  <p className="mt-1 text-[11px] leading-5 text-slate-500">価格 {formatMoney(item.quote.price, item.input.currency)} / {item.quote.date} / 鮮度: {item.comment.dataFreshness ?? "未記録"}</p>
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(item.id)}
                  className="w-fit rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[11px] font-bold text-slate-400 transition hover:border-red-300/30 hover:bg-red-300/10 hover:text-red-100"
                >
                  削除
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-4 rounded-xl border border-white/10 bg-slate-900/60 p-3 text-xs leading-5 text-slate-500">
          まだ履歴はありません。通常診断、詳細診断、または質問分析を実行すると自動保存されます。
        </p>
      )}
    </div>
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

function AiCommentPanel({ comment, mode, runtime }: { comment: AiRiskComment; mode: "normal" | "detailed"; runtime: { mode: "ai" | "rule"; model?: string; warning?: string; cached?: boolean } | null }) {
  const riskClass = comment.riskLevel === "高"
    ? "border-red-400/40 bg-red-400/15 text-red-100"
    : comment.riskLevel === "中"
      ? "border-yellow-300/40 bg-yellow-300/15 text-yellow-100"
      : "border-emerald-300/40 bg-emerald-300/15 text-emerald-100";
  const keyChecks = comment.checklist.slice(0, 3);
  const riskTone = comment.riskLevel === "高" ? "danger" : comment.riskLevel === "中" ? "warn" : "good";

  return (
    <div className="mt-4 border-t border-white/10 pt-4">
      <div className={`overflow-hidden rounded-2xl border ${insightToneClass(riskTone).border} ${insightToneClass(riskTone).bg}`}>
        <div className="flex flex-col gap-4 p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border text-lg font-black ${insightToneClass(riskTone).badge}`}>
              {comment.riskLevel === "高" ? "!" : comment.riskLevel === "中" ? "?" : "✓"}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-400">{mode === "detailed" ? "Detailed AI View" : "AI View"}</p>
                <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-black ${riskClass}`}>リスク {comment.riskLevel}</span>
                {comment.confidence ? <span className="inline-flex rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-black text-slate-200">信頼度 {comment.confidence}</span> : null}
              </div>
              <p className="mt-2 text-base font-black leading-7 text-slate-50 sm:text-lg">{comment.summary}</p>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <CompactSignal label="モード" value={runtime?.mode === "ai" ? "AI分析" : "ルール分析"} tone={runtime?.mode === "ai" ? "info" : "warn"} />
            <CompactSignal label="危険度" value={`リスク ${comment.riskLevel}`} tone={riskTone} />
            <CompactSignal label="危険ライン" value={comment.scenarioForecast?.dangerLevel ?? "未算出"} tone="danger" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {runtime ? (
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black ${
                runtime.mode === "ai"
                  ? "border-sky-300/35 bg-sky-300/10 text-sky-100"
                  : "border-yellow-300/35 bg-yellow-300/10 text-yellow-100"
              }`}>
                {runtime.mode === "ai" ? `AI分析${runtime.model ? ` / ${runtime.model}` : ""}` : "ルール分析"}
              </span>
            ) : null}
            {runtime?.cached ? (
              <span className="rounded-full border border-emerald-300/35 bg-emerald-300/10 px-2 py-0.5 text-[10px] font-black text-emerald-100">
                Cache再利用
              </span>
            ) : null}
          </div>
        </div>
      </div>
      {comment.userQuestionAnswer ? (
        <InsightCard title="質問への回答" icon="Q" tone="info" className="mt-3">
          <p className="mt-2 whitespace-pre-line text-sm leading-7 text-slate-200">{comment.userQuestionAnswer}</p>
        </InsightCard>
      ) : null}
      {mode === "detailed" && (comment.irView || comment.balanceSheetView || comment.incomeStatementView || comment.businessValueView) ? (
        <InsightCard title="IR / 財務 / 企業価値" icon="F" tone="info" className="mt-3">
          <div className="mt-3 grid gap-2">
            {comment.irView ? <ScenarioLine label="IR・開示" value={comment.irView} tone="info" icon="IR" /> : null}
            {comment.balanceSheetView ? <ScenarioLine label="BS" value={comment.balanceSheetView} tone="good" icon="BS" /> : null}
            {comment.incomeStatementView ? <ScenarioLine label="PL" value={comment.incomeStatementView} tone="macro" icon="PL" /> : null}
            {comment.businessValueView ? <ScenarioLine label="企業価値" value={comment.businessValueView} tone="warn" icon="EV" /> : null}
          </div>
        </InsightCard>
      ) : null}
      {comment.scenarioForecast ? (
        <InsightCard title="重要シナリオ" icon="S" tone="info" className="mt-3">
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            <ScenarioLine label="1〜2週間" value={comment.scenarioForecast.oneToTwoWeeks} tone="info" icon="1W" />
            <ScenarioLine label="上昇条件" value={comment.scenarioForecast.upsideTrigger} tone="good" icon="↑" />
            <ScenarioLine label="下落無効化" value={comment.scenarioForecast.downsideInvalidation} tone="danger" icon="↓" />
          </div>
          {comment.scenarioForecast.dangerLevel ? (
            <div className="mt-3 rounded-xl border border-red-300/30 bg-red-300/10 p-3">
              <p className="text-[11px] font-black uppercase tracking-[0.14em] text-red-200">Danger Line</p>
              <p className="mt-1 text-lg font-black text-red-100">{comment.scenarioForecast.dangerLevel}</p>
            </div>
          ) : null}
        </InsightCard>
      ) : null}
      {comment.macroImpactView ? (
        <InsightCard title="マクロ影響" icon="M" tone="macro" className="mt-3">
          <p className="mt-2 whitespace-pre-line text-sm leading-7 text-slate-200">{comment.macroImpactView}</p>
        </InsightCard>
      ) : null}
      {comment.largeMoneyFlowView ? (
        <InsightCard title="大口資金シグナル" icon="$" tone="good" className="mt-3">
          <p className="mt-2 whitespace-pre-line text-sm leading-7 text-slate-200">{comment.largeMoneyFlowView}</p>
        </InsightCard>
      ) : null}
      {comment.riskFilter ? (
        <InsightCard title="最重要リスク" icon="!" tone="warn" className="mt-3">
          <p className="mt-2 whitespace-pre-line text-sm leading-7 text-slate-200">{comment.riskFilter}</p>
        </InsightCard>
      ) : null}
      {runtime?.warning ? (
        <p className="mt-3 rounded-xl border border-yellow-300/25 bg-yellow-300/10 p-3 text-xs leading-5 text-yellow-100">
          {runtime.warning}
        </p>
      ) : null}
      {keyChecks.length ? (
        <div className="mt-3 rounded-2xl border border-white/10 bg-slate-950/45 p-3">
          <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-300">Check Next</p>
          <ul className="mt-3 grid gap-2">
            {keyChecks.map((item, index) => (
              <li key={item} className="flex gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs leading-5 text-slate-300">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-700 text-[10px] font-black text-slate-100">{index + 1}</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function InsightCard({
  title,
  icon,
  tone,
  className = "",
  children
}: {
  title: string;
  icon: string;
  tone: "info" | "good" | "warn" | "danger" | "macro";
  className?: string;
  children: ReactNode;
}) {
  const toneClass = insightToneClass(tone);
  return (
    <div className={`rounded-2xl border p-4 ${toneClass.border} ${toneClass.bg} ${className}`}>
      <div className="flex items-center gap-2">
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border text-xs font-black ${toneClass.badge}`}>
          {icon}
        </span>
        <p className={`text-xs font-black uppercase tracking-[0.16em] ${toneClass.title}`}>{title}</p>
      </div>
      {children}
    </div>
  );
}

function CompactSignal({ label, value, tone }: { label: string; value: string; tone: "info" | "good" | "warn" | "danger" | "macro" }) {
  const toneClass = insightToneClass(tone);
  return (
    <div className={`min-w-0 rounded-xl border p-3 ${toneClass.border} bg-slate-950/35`}>
      <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p className={`mt-1 truncate text-sm font-black ${toneClass.title}`}>{value}</p>
    </div>
  );
}

function ScenarioLine({ label, value, tone, icon }: { label: string; value: string; tone: "info" | "good" | "warn" | "danger" | "macro"; icon: string }) {
  const toneClass = insightToneClass(tone);
  return (
    <div className={`rounded-xl border p-3 ${toneClass.border} bg-slate-950/35`}>
      <div className="flex items-center gap-2">
        <span className={`flex h-6 min-w-6 items-center justify-center rounded-lg px-1.5 text-[10px] font-black ${toneClass.badge}`}>{icon}</span>
        <p className={`text-[11px] font-black uppercase tracking-[0.12em] ${toneClass.title}`}>{label}</p>
      </div>
      <p className="mt-1 text-xs leading-5 text-slate-300">{value}</p>
    </div>
  );
}

function insightToneClass(tone: "info" | "good" | "warn" | "danger" | "macro") {
  return {
    info: {
      border: "border-sky-300/22",
      bg: "bg-sky-300/[0.06]",
      badge: "border-sky-300/35 bg-sky-300/15 text-sky-100",
      title: "text-sky-100"
    },
    good: {
      border: "border-emerald-300/22",
      bg: "bg-emerald-300/[0.06]",
      badge: "border-emerald-300/35 bg-emerald-300/15 text-emerald-100",
      title: "text-emerald-100"
    },
    warn: {
      border: "border-amber-300/24",
      bg: "bg-amber-300/[0.07]",
      badge: "border-amber-300/40 bg-amber-300/15 text-amber-100",
      title: "text-amber-100"
    },
    danger: {
      border: "border-red-300/25",
      bg: "bg-red-300/[0.07]",
      badge: "border-red-300/40 bg-red-300/15 text-red-100",
      title: "text-red-100"
    },
    macro: {
      border: "border-violet-300/22",
      bg: "bg-violet-300/[0.06]",
      badge: "border-violet-300/35 bg-violet-300/15 text-violet-100",
      title: "text-violet-100"
    }
  }[tone];
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

function createHistoryId(ticker: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `${ticker}-${crypto.randomUUID()}`;
  return `${ticker}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
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
