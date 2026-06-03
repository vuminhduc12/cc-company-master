"use client";

import { useState } from "react";
import { aiTasks, news, prices, report } from "@/lib/mock-data";
import { scoreStock } from "@/lib/scoring";
import { useUserWatchlist } from "@/lib/user-watchlist";
import type { AiJobResult } from "@/types";

const storageKey = "d-finance-ai-job-result";

export default function SettingsPage() {
  const userWatchlist = useUserWatchlist();
  const [cronSecret, setCronSecret] = useState("");
  const [status, setStatus] = useState<"idle" | "running" | "completed" | "error">("idle");
  const [message, setMessage] = useState("");

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
        setMessage(`完了しました。Last Run: ${result.lastRun}${result.warning ? ` / Warning: ${result.warning}` : ""}`);
      } else {
        restoreStoredJobResult(previousStoredResult);
        setMessage(formatAiJobError(result.error ?? "Unknown error"));
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      restoreStoredJobResult(previousStoredResult);
      setStatus("error");
      setMessage(formatAiJobError(errorMessage));
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
      </section>
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
