"use client";

import { useEffect, useState } from "react";
import { resolveAiJobAudit } from "@/lib/ai-job-audit";
import { stockDataProviderPolicyNote, stockDataProviderPriority, stockDataProviderPriorityLabel } from "@/lib/data-provider-policy";
import { aiTasks, news, prices, report } from "@/lib/mock-data";
import { scoreStock } from "@/lib/scoring";
import { useUserWatchlist } from "@/lib/user-watchlist";
import type { AiJobResult } from "@/types";

const storageKey = "d-finance-ai-job-result";

type AiUsageSummary = {
  monthlyLimit: number;
  monthStart: string;
  totalCalls: number;
  billableCalls: number;
  remainingCalls: number;
  cacheHits: number;
  fallbackCount: number;
  limitExceededCount: number;
  rateLimitCount: number;
  errorCount: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  lastRateLimitAt?: string;
  recent: Array<{
    id: string;
    feature: string;
    ticker?: string;
    model?: string;
    status: string;
    errorCode?: string;
    errorMessage?: string;
    usedCache: boolean;
    estimatedCostUsd: number;
    createdAt: string;
  }>;
};

export default function SettingsPage() {
  const userWatchlist = useUserWatchlist();
  const [cronSecret, setCronSecret] = useState("");
  const [status, setStatus] = useState<"idle" | "running" | "completed" | "error">("idle");
  const [message, setMessage] = useState("");
  const [latestJobResult, setLatestJobResult] = useState<AiJobResult | null>(null);
  const [usageSummary, setUsageSummary] = useState<AiUsageSummary | null>(null);
  const executionAudit = resolveAiJobAudit(latestJobResult);

  useEffect(() => {
    const stored = localStorage.getItem(storageKey);
    if (!stored) return;
    try {
      setLatestJobResult(JSON.parse(stored) as AiJobResult);
    } catch {
      setLatestJobResult(null);
    }
  }, []);

  useEffect(() => {
    void refreshAiUsageSummary();
  }, []);

  async function refreshAiUsageSummary() {
    try {
      const response = await fetch("/api/ai-usage/summary", { cache: "no-store" });
      const payload = await response.json() as { ok: true; summary: AiUsageSummary } | { ok: false; error?: string };
      if (response.ok && payload.ok) setUsageSummary(payload.summary);
    } catch {
      setUsageSummary(null);
    }
  }

  async function runAiJob() {
    setStatus("running");
    setMessage("AI社員が今日の仕事を実行中です。");
    const previousStoredResult = localStorage.getItem(storageKey);
    const latest = prices[prices.length - 1];
    const now = new Date().toLocaleString("ja-JP");
    const runningResult: AiJobResult = {
      ok: false,
      mode: "mock",
      status: "Running",
      lastRun: now,
      nextRun: "次回 07:00 JST",
      dataFreshness: latest.date,
      aiMarketScore: scoreStock(latest, news),
      price: latest,
      news,
      tasks: aiTasks.map((task) => ({ ...task, status: "Running", lastRun: now, result: "実行中です。" })),
      report
    };
    localStorage.setItem(storageKey, JSON.stringify(runningResult));
    setLatestJobResult(runningResult);
    try {
      const response = await fetch("/api/cron/daily-job", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(cronSecret ? { "x-cron-secret": cronSecret } : {})
        },
        body: JSON.stringify({
          watchlist: userWatchlist.items.map((item) => item.stock)
        })
      });
      const result = await response.json() as AiJobResult;
      setStatus(result.ok ? "completed" : "error");
      if (result.ok) {
        localStorage.setItem(storageKey, JSON.stringify(result));
        setLatestJobResult(result);
        setMessage(`完了しました。Last Run: ${result.lastRun}${result.warning ? ` / Warning: ${result.warning}` : ""}`);
      } else {
        restoreStoredJobResult(previousStoredResult);
        setLatestJobResult(readStoredJobResult());
        setMessage(formatAiJobError(result.error ?? "Unknown error"));
      }
      await refreshAiUsageSummary();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      restoreStoredJobResult(previousStoredResult);
      setLatestJobResult(readStoredJobResult());
      setStatus("error");
      setMessage(formatAiJobError(errorMessage));
      await refreshAiUsageSummary();
    }
  }

  return (
    <div className="space-y-5">
      <div className="rounded-3xl border border-white/10 bg-slate-900/80 p-6 shadow-xl shadow-black/25 ring-1 ring-white/5">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-300">Control Center</p>
        <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-50">Settings</h2>
        <p className="mt-2 text-sm leading-6 text-slate-400">
          自動更新時間、監視銘柄、AI分析の強さ、手動実行をここで管理します。APIキーは.env.localで管理し、画面には表示しません。
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="rounded-2xl border border-white/10 bg-slate-900/80 p-5 text-sm text-slate-300 shadow-xl shadow-black/20 ring-1 ring-white/5">
          データ更新時間
          <input className="mt-2 block w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-slate-50 outline-none focus:border-sky-300/50" type="time" defaultValue="07:00" />
        </label>
        <label className="rounded-2xl border border-white/10 bg-slate-900/80 p-5 text-sm text-slate-300 shadow-xl shadow-black/20 ring-1 ring-white/5">
          監視銘柄
          <input className="mt-2 block w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-slate-50 outline-none focus:border-sky-300/50" defaultValue="RGTI, SIDU, IONQ, QBTS" />
        </label>
        <label className="rounded-2xl border border-white/10 bg-slate-900/80 p-5 text-sm text-slate-300 shadow-xl shadow-black/20 ring-1 ring-white/5">
          AI分析の強さ
          <input className="mt-2 block w-full accent-sky-400" type="range" min="1" max="10" defaultValue="7" />
        </label>
        <label className="rounded-2xl border border-white/10 bg-slate-900/80 p-5 text-sm text-slate-300 shadow-xl shadow-black/20 ring-1 ring-white/5">
          リスク許容度
          <select className="mt-2 block w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-slate-50 outline-none focus:border-sky-300/50" defaultValue="Balanced">
            <option>Conservative</option>
            <option>Balanced</option>
            <option>Aggressive</option>
          </select>
        </label>
      </div>

      <section className="rounded-2xl border border-emerald-300/20 bg-slate-900/80 p-5 shadow-xl shadow-black/20 ring-1 ring-white/5">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-300">Data Provider Policy</p>
            <h3 className="mt-2 text-lg font-semibold text-slate-50">株価データ取得の優先順位</h3>
            <p className="mt-2 text-sm leading-6 text-slate-400">{stockDataProviderPolicyNote}</p>
          </div>
          <span className="w-fit rounded-full border border-emerald-300/30 bg-emerald-300/10 px-3 py-1 text-xs font-black text-emerald-100">
            {stockDataProviderPriorityLabel}
          </span>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {stockDataProviderPriority.map((provider) => (
            <div key={provider} className="rounded-xl border border-white/10 bg-slate-950/45 px-3 py-3 text-xs font-bold text-slate-300">
              {provider}
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-sky-300/20 bg-slate-900/80 p-5 shadow-xl shadow-black/20 ring-1 ring-white/5">
        <h3 className="text-lg font-semibold text-slate-50">Manual AI Job</h3>
        <p className="mt-2 text-sm text-slate-400">
          ローカル開発ではCRON_SECRET未設定でも実行できます。本番でCRON_SECRETを設定した場合は、手動実行時にも同じ値を入力してください。
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]">
          <input
            className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-slate-50 outline-none focus:border-sky-300/50"
            placeholder="CRON_SECRET（本番手動実行用）"
            type="password"
            value={cronSecret}
            onChange={(event) => setCronSecret(event.target.value)}
          />
          <button
            className="rounded-xl bg-sky-400 px-5 py-2 text-sm font-bold text-slate-950 shadow-lg shadow-sky-950/30 transition hover:bg-sky-300 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={status === "running"}
            onClick={runAiJob}
          >
            {status === "running" ? "実行中..." : "AI社員に今日の仕事をさせる"}
          </button>
        </div>
        {message ? (
          <p className={status === "error" ? "mt-4 rounded-2xl border border-red-300/25 bg-red-400/10 p-4 whitespace-pre-line text-sm leading-6 text-red-100" : message.includes("Warning:") ? "mt-4 rounded-2xl border border-yellow-300/25 bg-yellow-300/10 p-4 whitespace-pre-line text-sm leading-6 text-yellow-100" : "mt-4 rounded-2xl border border-green-300/25 bg-green-400/10 p-4 whitespace-pre-line text-sm leading-6 text-green-100"}>
            {message}
          </p>
        ) : null}
        {executionAudit ? (
          <div className="mt-5 rounded-2xl border border-white/10 bg-slate-950/45 p-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <AuditMetric label="完了銘柄" value={`${executionAudit.completedStocks}/${executionAudit.totalStocks}`} tone={executionAudit.failedStocks ? "yellow" : "green"} />
              <AuditMetric label="AI分析ニュース" value={executionAudit.aiNewsCount} tone="blue" />
              <AuditMetric label="ルール代替ニュース" value={executionAudit.ruleNewsCount} tone={executionAudit.ruleNewsCount ? "yellow" : "green"} />
              <AuditMetric label="最新ニュース日" value={executionAudit.latestNewsDate ?? "-"} />
            </div>
            <div className="mt-4 space-y-2">
              {executionAudit.stocks.map((item) => (
                <div key={item.ticker} className="rounded-xl border border-white/10 bg-slate-900/70 p-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-sm font-black text-slate-100">{item.ticker}</p>
                      <p className="mt-1 text-xs leading-5 text-slate-500">株価: {item.priceSource} / 鮮度: {item.priceFreshness}</p>
                    </div>
                    <span className={item.status === "Error" ? "w-fit rounded-full border border-red-300/35 bg-red-300/10 px-2.5 py-1 text-xs font-black text-red-100" : "w-fit rounded-full border border-emerald-300/35 bg-emerald-300/10 px-2.5 py-1 text-xs font-black text-emerald-100"}>
                      {item.status}
                    </span>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-slate-300">News {item.newsCount}件 / AI {item.aiNewsCount}件 / Rule {item.ruleNewsCount}件{item.latestNewsDate ? ` / 最新 ${item.latestNewsDate}` : ""}</p>
                  {item.fallbackReason || item.warning || item.error ? (
                    <p className="mt-2 rounded-lg border border-yellow-300/20 bg-yellow-300/10 px-3 py-2 text-xs leading-5 text-yellow-100">
                      {item.fallbackReason || item.warning || item.error}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      <section className="rounded-2xl border border-amber-300/20 bg-slate-900/80 p-5 shadow-xl shadow-black/20 ring-1 ring-white/5">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-300">OpenAI Usage Guard</p>
            <h3 className="mt-2 text-lg font-semibold text-slate-50">AI使用量・429フォールバック</h3>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              OpenAI呼び出し前に月間/日次上限を確認し、429や上限超過時はルールベース分析へ切り替えます。
            </p>
          </div>
          <button
            className="w-fit rounded-xl border border-amber-300/30 bg-amber-300/10 px-3 py-2 text-xs font-black text-amber-100 hover:bg-amber-300/15"
            onClick={() => void refreshAiUsageSummary()}
          >
            再読込
          </button>
        </div>
        {usageSummary ? (
          <>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <AuditMetric label="AI使用回数" value={`${usageSummary.billableCalls}/${usageSummary.monthlyLimit}`} tone={usageSummary.remainingCalls <= 5 ? "yellow" : "blue"} />
              <AuditMetric label="残り回数" value={usageSummary.remainingCalls} tone={usageSummary.remainingCalls <= 5 ? "yellow" : "green"} />
              <AuditMetric label="429発生" value={usageSummary.rateLimitCount} tone={usageSummary.rateLimitCount ? "yellow" : "green"} />
              <AuditMetric label="推定コスト" value={`$${usageSummary.estimatedCostUsd.toFixed(4)}`} />
              <AuditMetric label="キャッシュ再利用" value={usageSummary.cacheHits} tone="green" />
              <AuditMetric label="ルール切替" value={usageSummary.fallbackCount} tone={usageSummary.fallbackCount ? "yellow" : "green"} />
              <AuditMetric label="ローカル上限超過" value={usageSummary.limitExceededCount} tone={usageSummary.limitExceededCount ? "yellow" : "green"} />
              <AuditMetric label="最終429" value={usageSummary.lastRateLimitAt ? formatDateTime(usageSummary.lastRateLimitAt) : "-"} />
            </div>
            <div className="mt-4 space-y-2">
              {usageSummary.recent.length ? usageSummary.recent.slice(0, 8).map((item) => (
                <div key={item.id} className="grid gap-2 rounded-xl border border-white/10 bg-slate-950/45 p-3 text-xs text-slate-300 sm:grid-cols-[110px_1fr_auto] sm:items-center">
                  <span className={item.status === "success" || item.status === "cache_hit" ? "font-black text-emerald-300" : item.status === "fallback" || item.status === "limit_exceeded" ? "font-black text-yellow-300" : "font-black text-red-300"}>
                    {item.status}
                  </span>
                  <span className="min-w-0 break-words">
                    {item.feature}{item.ticker ? ` / ${item.ticker}` : ""}{item.model ? ` / ${item.model}` : ""}
                    {item.errorMessage ? ` / ${item.errorMessage}` : ""}
                  </span>
                  <span className="text-slate-500">{formatDateTime(item.createdAt)}</span>
                </div>
              )) : (
                <p className="rounded-xl border border-white/10 bg-slate-950/45 p-3 text-sm text-slate-500">まだAI使用履歴はありません。</p>
              )}
            </div>
          </>
        ) : (
          <p className="mt-4 rounded-xl border border-white/10 bg-slate-950/45 p-3 text-sm text-slate-500">
            使用量データを読み込み中、またはまだ履歴がありません。
          </p>
        )}
      </section>
    </div>
  );
}

function AuditMetric({ label, value, tone = "default" }: { label: string; value: string | number; tone?: "default" | "green" | "yellow" | "blue" }) {
  const color = {
    default: "text-slate-50",
    green: "text-emerald-300",
    yellow: "text-yellow-300",
    blue: "text-sky-300"
  }[tone];

  return (
    <div className="rounded-xl border border-white/10 bg-slate-900/75 p-3">
      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <p className={`mt-2 break-words text-lg font-black ${color}`}>{value}</p>
    </div>
  );
}

function formatAiJobError(message: string) {
  const lower = message.toLowerCase();
  if (lower.includes("quota") || lower.includes("exceeded") || lower.includes("rate limit") || lower.includes("429")) {
    return [
      "AI Jobは実行されませんでした。",
      "原因: OpenAI APIまたはNews APIの利用上限に達しています。",
      "対処: APIの課金/利用上限を確認するか、時間を置いて再実行してください。",
      "画面の保存済みデータは上書きしていません。"
    ].join("\n");
  }
  if (lower.includes("cron_secret") || lower.includes("invalid")) {
    return [
      "AI Jobは実行されませんでした。",
      "原因: CRON_SECRETが未設定、または入力値が違います。",
      "対処: .env.localのCRON_SECRETと同じ値を入力してください。"
    ].join("\n");
  }
  if (lower.includes("api key") || lower.includes("openai_api_key") || lower.includes("news_api_key")) {
    return [
      "AI Jobは実行されませんでした。",
      "原因: APIキーが未設定、または無効です。",
      "対処: .env.localのOPENAI_API_KEY / NEWS_API_KEYを確認してください。"
    ].join("\n");
  }
  return `AI Jobは実行されませんでした。\n原因: ${message}`;
}

function restoreStoredJobResult(previousStoredResult: string | null) {
  if (previousStoredResult) {
    localStorage.setItem(storageKey, previousStoredResult);
  } else {
    localStorage.removeItem(storageKey);
  }
}

function readStoredJobResult() {
  const stored = localStorage.getItem(storageKey);
  if (!stored) return null;
  try {
    return JSON.parse(stored) as AiJobResult;
  } catch {
    return null;
  }
}

function formatDateTime(value: string | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}
