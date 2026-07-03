"use client";

import { useEffect, useState } from "react";
import { AuthPanel } from "@/components/AuthPanel";
import { LiveWatchlistStrip } from "@/components/LiveWatchlistStrip";
import { PlanUpgradePanel } from "@/components/PlanUpgradePanel";
import { HeaderPill, PageHeader } from "@/components/PageHeader";
import { resolveAiJobAudit } from "@/lib/ai-job-audit";
import { authHeaders } from "@/lib/auth-fetch";
import { stockDataProviderPolicyNote, stockDataProviderPriority, stockDataProviderPriorityLabel } from "@/lib/data-provider-policy";
import { aiTasks, news, prices, report } from "@/lib/mock-data";
import { useNewsPreferencesSyncStatus, type NewsPreferenceSyncStatus } from "@/lib/news-preferences";
import { planDefinitions, type PlanDefinition } from "@/lib/plans";
import { scoreStock } from "@/lib/scoring";
import { aiJobResultChangedEvent, storageKey } from "@/lib/use-ai-job-result";
import { useUserWatchlist } from "@/lib/user-watchlist";
import type { AiJobResult, Stock, WatchlistItem } from "@/types";

const settingsStorageKey = "dfinance.settings.v1";

type AppSettings = {
  updateTime: string;
  watchlistText: string;
  aiStrength: string;
  riskTolerance: string;
};

const defaultSettings: AppSettings = {
  updateTime: "07:00",
  watchlistText: "RGTI, SIDU, IONQ, QBTS",
  aiStrength: "7",
  riskTolerance: "Balanced"
};

type AiUsageSummary = {
  plan: PlanDefinition;
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

type HealthStatus = {
  config: {
    openaiApiKey: boolean;
    dailyOpenAiEnabled: boolean;
    newsApiKey: boolean;
    twelveDataKey: boolean;
    cronSecret: boolean;
  };
  checks: {
    hasRecentJob: boolean;
    cronProtected: boolean;
  };
  latestJob: {
    status: string | null;
    ageHours: number | null;
  } | null;
  recommendations: string[];
};

export default function SettingsPage() {
  const userWatchlist = useUserWatchlist();
  const [cronSecret, setCronSecret] = useState("");
  const [status, setStatus] = useState<"idle" | "running" | "completed" | "error">("idle");
  const [message, setMessage] = useState("");
  const [latestJobResult, setLatestJobResult] = useState<AiJobResult | null>(null);
  const [usageSummary, setUsageSummary] = useState<AiUsageSummary | null>(null);
  const [healthStatus, setHealthStatus] = useState<HealthStatus | null>(null);
  const [appSettings, setAppSettings] = useState<AppSettings>(defaultSettings);
  const executionAudit = resolveAiJobAudit(latestJobResult);
  const newsSync = useNewsPreferencesSyncStatus();

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
    const stored = localStorage.getItem(settingsStorageKey);
    if (!stored) return;
    try {
      setAppSettings({ ...defaultSettings, ...JSON.parse(stored) as Partial<AppSettings> });
    } catch {
      setAppSettings(defaultSettings);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(settingsStorageKey, JSON.stringify(appSettings));
  }, [appSettings]);

  useEffect(() => {
    void refreshAiUsageSummary();
    void refreshHealthStatus();
  }, []);

  async function refreshAiUsageSummary() {
    try {
      const response = await fetch("/api/ai-usage/summary", {
        cache: "no-store",
        headers: await authHeaders()
      });
      const payload = await response.json() as { ok: true; summary: AiUsageSummary } | { ok: false; error?: string };
      if (response.ok && payload.ok) setUsageSummary(payload.summary);
    } catch {
      setUsageSummary(null);
    }
  }

  async function refreshHealthStatus() {
    try {
      const response = await fetch("/api/health", { cache: "no-store" });
      const payload = await response.json() as { ok: true } & HealthStatus;
      if (response.ok || payload.config) setHealthStatus(payload);
    } catch {
      setHealthStatus(null);
    }
  }

  async function runAiJob(useOpenAi: boolean) {
    const targetStocks = parseManualJobStocks(appSettings.watchlistText, userWatchlist.items);
    if (targetStocks.length === 0) {
      setStatus("error");
      setMessage("AI Jobは実行されませんでした。\n原因: Settingsの監視銘柄が空、または有効な銘柄コードがありません。\n例: RGTI, SIDU, IONQ, 6693.T");
      return;
    }

    setStatus("running");
    setMessage(`${useOpenAi ? "OpenAI分析込み" : "無料API中心"}で更新中です。対象: ${targetStocks.map((stock) => stock.ticker).join(", ")}`);
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
    window.dispatchEvent(new CustomEvent(aiJobResultChangedEvent));
    setLatestJobResult(runningResult);
    try {
      const response = await fetch("/api/cron/daily-job", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...await authHeaders(),
          ...(cronSecret ? { "x-cron-secret": cronSecret } : {})
        },
        body: JSON.stringify({
          watchlist: targetStocks,
          useOpenAi
        })
      });
      const result = await response.json() as AiJobResult;
      setStatus(result.ok ? "completed" : "error");
      if (result.ok) {
        localStorage.setItem(storageKey, JSON.stringify(result));
        window.dispatchEvent(new CustomEvent(aiJobResultChangedEvent));
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
      <LiveWatchlistStrip />
      <PageHeader
        eyebrow="Control Center"
        title="Settings"
        description="更新時間、監視銘柄、AI Job実行を管理します。APIキーは.env.localで管理します。"
        actions={(
          <>
            <HeaderPill label={usageSummary?.plan.name ?? "Free"} tone="blue" />
            <HeaderPill label={healthStatus?.config.dailyOpenAiEnabled ? "朝AI ON" : "朝AI OFF"} tone={healthStatus?.config.dailyOpenAiEnabled ? "yellow" : "green"} />
            <HeaderPill label={`AI残り ${formatRemainingAiCalls(usageSummary)}`} tone={usageSummary?.plan.isUnlimited || (usageSummary?.remainingCalls ?? 1) > 0 ? "green" : "red"} />
            <HeaderPill label={status === "running" ? "Job Running" : latestJobResult?.status ?? "Job Pending"} tone={status === "error" ? "red" : status === "running" ? "yellow" : "default"} />
          </>
        )}
      />

      <AuthPanel />

      <NewsSyncStatusPanel status={newsSync.status} onRefresh={() => void newsSync.refresh()} />

      <CostControlPanel
        health={healthStatus}
        usageSummary={usageSummary}
        onRefresh={() => {
          void refreshHealthStatus();
          void refreshAiUsageSummary();
        }}
      />

      <section className="rounded-2xl border border-fuchsia-300/20 bg-slate-900/80 p-5 shadow-xl shadow-black/20 ring-1 ring-white/5">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-fuchsia-300">Plan Limits</p>
            <h3 className="mt-2 text-lg font-semibold text-slate-50">プラン制限</h3>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              Watchlist数とAI使用回数をプラン別に制限します。Stripe連携前はSupabaseのuser_plansテーブルで手動変更できます。
            </p>
          </div>
          <span className="w-fit rounded-full border border-fuchsia-300/35 bg-fuchsia-300/10 px-3 py-1 text-xs font-black text-fuchsia-100">
            Current: {usageSummary?.plan.name ?? "Free"}
          </span>
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-4">
          {Object.values(planDefinitions).map((plan) => {
            const active = usageSummary?.plan.key === plan.key || (!usageSummary && plan.key === "free");
            return (
              <div key={plan.key} className={active ? "rounded-2xl border border-fuchsia-300/45 bg-fuchsia-300/10 p-4 ring-1 ring-fuchsia-200/20" : "rounded-2xl border border-white/10 bg-slate-950/45 p-4"}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-lg font-black text-slate-50">{plan.name}</p>
                    <p className="mt-1 text-xs leading-5 text-slate-500">{plan.description}</p>
                  </div>
                  {active ? <span className="rounded-full bg-fuchsia-300 px-2.5 py-1 text-[11px] font-black text-slate-950">ACTIVE</span> : null}
                </div>
                <p className="mt-3 text-sm font-black text-slate-100">
                  {plan.monthlyPriceJpy > 0 ? `¥${plan.monthlyPriceJpy.toLocaleString("ja-JP")} / 月` : "無料"}
                </p>
                <div className="mt-4 grid gap-2 text-sm">
                  <PlanLimit label="Watchlist" value={formatPlanLimit(plan.watchlistItems, "銘柄", plan.isUnlimited)} />
                  <PlanLimit label="AI月間" value={formatPlanLimit(plan.monthlyAiCalls, "回", plan.isUnlimited)} />
                  <PlanLimit label="AI日次" value={formatPlanLimit(plan.dailyAiCalls, "回", plan.isUnlimited)} />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <PlanUpgradePanel currentPlan={usageSummary?.plan.key} />

      <div className="grid gap-4 md:grid-cols-2">
        <label className="rounded-2xl border border-white/10 bg-slate-900/80 p-5 text-sm text-slate-300 shadow-xl shadow-black/20 ring-1 ring-white/5">
          データ更新時間
          <input
            className="mt-2 block w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-slate-50 outline-none focus:border-sky-300/50"
            type="time"
            value={appSettings.updateTime}
            onChange={(event) => setAppSettings((current) => ({ ...current, updateTime: event.target.value }))}
          />
        </label>
        <label className="rounded-2xl border border-white/10 bg-slate-900/80 p-5 text-sm text-slate-300 shadow-xl shadow-black/20 ring-1 ring-white/5">
          監視銘柄
          <input
            className="mt-2 block w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-slate-50 outline-none focus:border-sky-300/50"
            value={appSettings.watchlistText}
            onChange={(event) => setAppSettings((current) => ({ ...current, watchlistText: event.target.value }))}
          />
          <span className="mt-2 block text-xs leading-5 text-slate-500">
            Manual AI Jobはここに入力した銘柄だけ更新します。例: RGTI, SIDU, IONQ, 6693.T
          </span>
        </label>
        <label className="rounded-2xl border border-white/10 bg-slate-900/80 p-5 text-sm text-slate-300 shadow-xl shadow-black/20 ring-1 ring-white/5">
          AI分析の強さ
          <input
            className="mt-2 block w-full accent-sky-400"
            type="range"
            min="1"
            max="10"
            value={appSettings.aiStrength}
            onChange={(event) => setAppSettings((current) => ({ ...current, aiStrength: event.target.value }))}
          />
          <p className="mt-2 text-xs text-slate-500">現在値: {appSettings.aiStrength}</p>
        </label>
        <label className="rounded-2xl border border-white/10 bg-slate-900/80 p-5 text-sm text-slate-300 shadow-xl shadow-black/20 ring-1 ring-white/5">
          リスク許容度
          <select
            className="mt-2 block w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-slate-50 outline-none focus:border-sky-300/50"
            value={appSettings.riskTolerance}
            onChange={(event) => setAppSettings((current) => ({ ...current, riskTolerance: event.target.value }))}
          >
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
          手動実行はOpenAI分析の対象です。ローカル開発ではCRON_SECRET未設定でも実行できます。本番でCRON_SECRETを設定した場合は、手動実行時にも同じ値を入力してください。
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-emerald-300/20 bg-emerald-300/10 p-3">
            <p className="text-xs font-black uppercase tracking-[0.14em] text-emerald-200">無料自動更新</p>
            <p className="mt-2 text-sm leading-6 text-emerald-50">毎朝の自動ジョブはOpenAIを使わず、株価・SEC EDGAR・IRニュース・ルール分析を更新します。</p>
          </div>
          <div className="rounded-xl border border-amber-300/20 bg-amber-300/10 p-3">
            <p className="text-xs font-black uppercase tracking-[0.14em] text-amber-200">手動OpenAI分析</p>
            <p className="mt-2 text-sm leading-6 text-amber-50">このManual AI Jobは、OPENAI_API_KEYが設定済みならOpenAI料金の対象です。</p>
          </div>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]">
          <input
            className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-slate-50 outline-none focus:border-sky-300/50"
            placeholder="CRON_SECRET（APIキーではありません）"
            type="password"
            value={cronSecret}
            onChange={(event) => setCronSecret(event.target.value)}
          />
          <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-1">
            <button
              className="rounded-xl border border-emerald-300/30 bg-emerald-300/10 px-5 py-2 text-sm font-bold text-emerald-100 transition hover:bg-emerald-300/15 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={status === "running"}
              onClick={() => void runAiJob(false)}
              type="button"
            >
              {status === "running" ? "実行中..." : "無料更新だけ実行"}
            </button>
            <button
              className="rounded-xl bg-sky-400 px-5 py-2 text-sm font-bold text-slate-950 shadow-lg shadow-sky-950/30 transition hover:bg-sky-300 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={status === "running"}
              onClick={() => void runAiJob(true)}
              type="button"
            >
              {status === "running" ? "実行中..." : "OpenAI分析も実行"}
            </button>
          </div>
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
              AI Job開始時に月間/日次上限をJST基準で確認します。ニュースごとのOpenAI呼び出しはAPI実行ログとして残し、429時はルールベース分析へ切り替えます。
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
              <AuditMetric label="AI使用回数" value={usageSummary.plan.isUnlimited ? `${usageSummary.billableCalls}/無制限` : `${usageSummary.billableCalls}/${usageSummary.monthlyLimit}`} tone={usageSummary.plan.isUnlimited || usageSummary.remainingCalls > 5 ? "blue" : "yellow"} />
              <AuditMetric label="残り回数" value={usageSummary.plan.isUnlimited ? "無制限" : usageSummary.remainingCalls} tone={usageSummary.plan.isUnlimited || usageSummary.remainingCalls > 5 ? "green" : "yellow"} />
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
                  <span className={item.status === "success" || item.status === "api_success" || item.status === "cache_hit" ? "font-black text-emerald-300" : item.status === "fallback" || item.status === "limit_exceeded" ? "font-black text-yellow-300" : "font-black text-red-300"}>
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

function CostControlPanel({ health, usageSummary, onRefresh }: { health: HealthStatus | null; usageSummary: AiUsageSummary | null; onRefresh: () => void }) {
  const openAiConfigured = Boolean(health?.config.openaiApiKey);
  const dailyOpenAiEnabled = Boolean(health?.config.dailyOpenAiEnabled);
  const manualAiLabel = openAiConfigured ? "有効" : "未設定";
  const dailyAiLabel = dailyOpenAiEnabled ? "有効" : "無効";

  return (
    <section className="rounded-2xl border border-sky-300/20 bg-slate-900/80 p-5 shadow-xl shadow-black/20 ring-1 ring-white/5">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-300">Cost Control</p>
          <h3 className="mt-2 text-lg font-semibold text-slate-50">無料自動更新 / 手動OpenAIの分離</h3>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            自動更新は無料APIとルール分析を優先します。OpenAIを使う処理は、Manual AI Jobまたは個別AI診断を手動実行した時だけです。
          </p>
        </div>
        <button
          className="w-fit rounded-xl border border-sky-300/30 bg-sky-300/10 px-3 py-2 text-xs font-black text-sky-100 hover:bg-sky-300/15"
          onClick={onRefresh}
          type="button"
        >
          状態更新
        </button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <AuditMetric label="毎朝OpenAI" value={dailyAiLabel} tone={dailyOpenAiEnabled ? "yellow" : "green"} />
        <AuditMetric label="手動OpenAI" value={manualAiLabel} tone={openAiConfigured ? "yellow" : "blue"} />
        <AuditMetric label="SEC / IR自動更新" value="無料API" tone="green" />
        <AuditMetric label="今月推定OpenAI" value={`$${(usageSummary?.estimatedCostUsd ?? 0).toFixed(4)}`} tone={(usageSummary?.estimatedCostUsd ?? 0) > 0 ? "yellow" : "green"} />
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-emerald-300/20 bg-emerald-300/10 p-4">
          <p className="text-xs font-black uppercase tracking-[0.14em] text-emerald-200">無料で自動更新</p>
          <ul className="mt-3 space-y-2 text-sm leading-6 text-emerald-50">
            <li>・株価更新、SEC EDGAR、IRニュース監視</li>
            <li>・毎朝ジョブのニュース判断はルールベース</li>
            <li>・ENABLE_DAILY_OPENAI=true の時だけ毎朝OpenAIを使う</li>
          </ul>
        </div>
        <div className="rounded-xl border border-amber-300/20 bg-amber-300/10 p-4">
          <p className="text-xs font-black uppercase tracking-[0.14em] text-amber-200">手動でOpenAI使用</p>
          <ul className="mt-3 space-y-2 text-sm leading-6 text-amber-50">
            <li>・Manual AI Job</li>
            <li>・個別銘柄のAI診断、AIへの質問</li>
            <li>・マクロAI分析は ai=1 を明示した時のみ</li>
          </ul>
        </div>
      </div>

      {health?.recommendations.length ? (
        <p className="mt-4 rounded-xl border border-white/10 bg-slate-950/45 p-3 text-xs leading-5 text-slate-400">
          {health.recommendations[0]}
        </p>
      ) : null}
    </section>
  );
}

function NewsSyncStatusPanel({ status, onRefresh }: { status: NewsPreferenceSyncStatus; onRefresh: () => void }) {
  const tone = status.checking
    ? "yellow"
    : status.synced
      ? "green"
      : status.configured && status.signedIn
        ? "yellow"
        : "default";
  const badgeClass = {
    default: "border-white/10 bg-white/[0.055] text-slate-300",
    green: "border-emerald-300/30 bg-emerald-300/10 text-emerald-100",
    yellow: "border-amber-300/30 bg-amber-300/10 text-amber-100"
  }[tone];
  const statusLabel = status.checking ? "Checking" : status.synced ? "Synced" : status.signedIn ? "Needs setup" : "Local only";

  return (
    <section className="rounded-2xl border border-cyan-300/20 bg-slate-900/80 p-5 shadow-xl shadow-black/20 ring-1 ring-white/5">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300">News Sync</p>
          <h3 className="mt-2 text-lg font-semibold text-slate-50">通知既読・非表示News同期</h3>
          <p className="mt-2 text-sm leading-6 text-slate-400">{status.message}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <span className={`w-fit rounded-full border px-3 py-1.5 text-xs font-black ${badgeClass}`}>{statusLabel}</span>
          <button
            className="w-fit rounded-xl border border-cyan-300/30 bg-cyan-300/10 px-3 py-2 text-xs font-black text-cyan-100 hover:bg-cyan-300/15 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={status.checking}
            onClick={onRefresh}
            type="button"
          >
            {status.checking ? "確認中" : "再同期"}
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <AuditMetric label="Supabase" value={status.configured ? "Configured" : "Not configured"} tone={status.configured ? "green" : "yellow"} />
        <AuditMetric label="Login" value={status.signedIn ? "Signed in" : "Local mode"} tone={status.signedIn ? "green" : "yellow"} />
        <AuditMetric label="非表示News" value={`${status.hiddenLocalCount}${status.hiddenRemoteCount !== null ? ` / DB ${status.hiddenRemoteCount}` : ""}`} tone={status.synced ? "green" : "blue"} />
        <AuditMetric label="通知既読" value={`${status.seenLocalCount}${status.seenRemoteCount !== null ? ` / DB ${status.seenRemoteCount}` : ""}`} tone={status.synced ? "green" : "blue"} />
      </div>

      {!status.synced && status.configured && status.signedIn ? (
        <p className="mt-4 rounded-xl border border-amber-300/20 bg-amber-300/10 p-3 text-xs leading-5 text-amber-100">
          Supabase SQL Editorで <span className="font-black">user_news_preferences</span> テーブルとRLSを適用してください。DB未適用でもlocalStorageで利用は継続します。
        </p>
      ) : null}
      {status.lastSyncedAt ? (
        <p className="mt-3 text-xs text-slate-500">最終同期: {formatDateTime(status.lastSyncedAt)}</p>
      ) : null}
    </section>
  );
}

function formatRemainingAiCalls(summary: AiUsageSummary | null) {
  if (!summary) return "-";
  return summary.plan.isUnlimited ? "無制限" : `${summary.remainingCalls}回`;
}

function formatPlanLimit(value: number, suffix: string, isUnlimited?: boolean) {
  return isUnlimited ? "無制限" : `${value.toLocaleString("ja-JP")}${suffix}`;
}

function PlanLimit({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-slate-950/55 px-3 py-2">
      <span className="text-xs font-bold text-slate-500">{label}</span>
      <span className="text-sm font-black text-slate-100">{value}</span>
    </div>
  );
}

function parseManualJobStocks(value: string, watchlistItems: WatchlistItem[]): Stock[] {
  const existingStocks = new Map(watchlistItems.map((item) => [item.stock.ticker, item.stock]));
  const seen = new Set<string>();
  return value
    .split(/[\s,、]+/)
    .map((ticker) => normalizeManualJobTicker(ticker))
    .filter((ticker) => ticker && /^[A-Z0-9.-]{1,12}$/.test(ticker))
    .flatMap((ticker): Stock[] => {
      if (seen.has(ticker)) return [];
      seen.add(ticker);
      const existing = existingStocks.get(ticker);
      if (existing) return [existing];
      const isJapanese = /^\d{4}\.T$/i.test(ticker);
      return [{
        ticker,
        companyName: ticker,
        sector: isJapanese ? "Japan Equity" : "US Equity",
        exchange: isJapanese ? "TSE" : "NASDAQ/NYSE"
      }];
    });
}

function normalizeManualJobTicker(value: string) {
  const ticker = value.trim().toUpperCase();
  if (!ticker) return "";
  if (/^\d{4}$/.test(ticker)) return `${ticker}.T`;
  if (/^\d{4}\.JP$/i.test(ticker)) return ticker.replace(/\.JP$/i, ".T");
  return ticker;
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
  if (lower.includes("login is required") || message.includes("ログインが必要")) {
    return [
      "AI Jobは実行されませんでした。",
      "原因: 手動AI Jobはログインが必要です。",
      "対処: スマホでログインし直してから再実行してください。"
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
  window.dispatchEvent(new CustomEvent(aiJobResultChangedEvent));
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
