"use client";

import { useState } from "react";
import { aiTasks, news, prices, report } from "@/lib/mock-data";
import { scoreStock } from "@/lib/scoring";
import type { AiJobResult } from "@/types";

const storageKey = "d-finance-ai-job-result";

export default function SettingsPage() {
  const [cronSecret, setCronSecret] = useState("");
  const [status, setStatus] = useState<"idle" | "running" | "completed" | "error">("idle");
  const [message, setMessage] = useState("");

  async function runAiJob() {
    setStatus("running");
    setMessage("AI社員が今日の仕事を実行中です。");
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
        headers: cronSecret ? { "x-cron-secret": cronSecret } : undefined
      });
      const result = await response.json() as AiJobResult;
      localStorage.setItem(storageKey, JSON.stringify(result));
      setStatus(result.ok ? "completed" : "error");
      setMessage(result.ok ? `完了しました。Last Run: ${result.lastRun}${result.warning ? ` / Warning: ${result.warning}` : ""}` : `Error: ${result.error ?? "Unknown error"}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      const now = new Date().toLocaleString("ja-JP");
      const failedResult: Partial<AiJobResult> = {
        ok: false,
        status: "Error",
        lastRun: now,
        error: errorMessage
      };
      localStorage.setItem(storageKey, JSON.stringify(failedResult));
      setStatus("error");
      setMessage(`Error: ${errorMessage}`);
    }
  }

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold text-slate-50">Settings</h2>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="rounded-2xl border border-white/10 bg-slate-900/75 p-5 text-sm text-slate-300">
          データ更新時間
          <input className="mt-2 block w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-slate-50" type="time" defaultValue="07:00" />
        </label>
        <label className="rounded-2xl border border-white/10 bg-slate-900/75 p-5 text-sm text-slate-300">
          監視銘柄
          <input className="mt-2 block w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-slate-50" defaultValue="RGTI, IONQ, QBTS" />
        </label>
        <label className="rounded-2xl border border-white/10 bg-slate-900/75 p-5 text-sm text-slate-300">
          AI分析の強さ
          <input className="mt-2 block w-full accent-sky-400" type="range" min="1" max="10" defaultValue="7" />
        </label>
        <label className="rounded-2xl border border-white/10 bg-slate-900/75 p-5 text-sm text-slate-300">
          リスク許容度
          <select className="mt-2 block w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-slate-50" defaultValue="Balanced">
            <option>Conservative</option>
            <option>Balanced</option>
            <option>Aggressive</option>
          </select>
        </label>
      </div>

      <section className="rounded-2xl border border-sky-300/20 bg-slate-900/75 p-5 shadow-lg shadow-black/20">
        <h3 className="text-lg font-semibold text-slate-50">Manual AI Job</h3>
        <p className="mt-2 text-sm text-slate-400">
          ローカル開発ではCRON_SECRET未設定でも実行できます。本番でCRON_SECRETを設定した場合は、手動実行時にも同じ値を入力してください。
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]">
          <input
            className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-slate-50"
            placeholder="CRON_SECRET（本番手動実行用）"
            type="password"
            value={cronSecret}
            onChange={(event) => setCronSecret(event.target.value)}
          />
          <button
            className="rounded-lg bg-sky-400 px-5 py-2 text-sm font-bold text-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={status === "running"}
            onClick={runAiJob}
          >
            {status === "running" ? "実行中..." : "AI社員に今日の仕事をさせる"}
          </button>
        </div>
        {message ? (
          <p className={status === "error" ? "mt-4 whitespace-pre-line text-sm text-red-300" : message.includes("Warning:") ? "mt-4 whitespace-pre-line text-sm text-yellow-200" : "mt-4 whitespace-pre-line text-sm text-green-300"}>
            {message}
          </p>
        ) : null}
      </section>
    </div>
  );
}
