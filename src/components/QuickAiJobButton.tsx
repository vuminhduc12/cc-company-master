"use client";

import { useState } from "react";
import { authHeaders } from "@/lib/auth-fetch";
import { aiJobResultChangedEvent, storageKey } from "@/lib/use-ai-job-result";
import { useUserWatchlist } from "@/lib/user-watchlist";
import type { AiJobResult } from "@/types";

type RunStatus = "idle" | "running" | "done" | "error";

export function QuickAiJobButton() {
  const userWatchlist = useUserWatchlist();
  const [open, setOpen] = useState(false);
  const [secret, setSecret] = useState("");
  const [status, setStatus] = useState<RunStatus>("idle");
  const [message, setMessage] = useState("");

  async function run(useOpenAi: boolean) {
    const tickers = userWatchlist.items.map((i) => ({
      ticker: i.stock.ticker,
      companyName: i.stock.companyName,
      sector: i.stock.sector,
      exchange: i.stock.exchange,
    }));
    if (tickers.length === 0) {
      setStatus("error");
      setMessage("Watchlistに銘柄がありません。先に銘柄を追加してください。");
      return;
    }

    setStatus("running");
    setMessage(`${tickers.map((t) => t.ticker).join(", ")} を${useOpenAi ? "OpenAI分析込みで" : "無料API中心で"}更新中…`);

    try {
      const response = await fetch("/api/cron/daily-job", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...await authHeaders(),
          ...(secret ? { "x-cron-secret": secret } : {}),
        },
        body: JSON.stringify({ watchlist: tickers, useOpenAi }),
      });
      const result = await response.json() as AiJobResult;
      if (result.ok) {
        localStorage.setItem(storageKey, JSON.stringify(result));
        window.dispatchEvent(new CustomEvent(aiJobResultChangedEvent));
        setStatus("done");
        setMessage(`完了 ✓  ${result.lastRun ?? ""}${result.warning ? ` / ${result.warning}` : ""}`);
        // 3秒後に自動で閉じる
        setTimeout(() => { setOpen(false); setStatus("idle"); setMessage(""); }, 3000);
      } else {
        setStatus("error");
        setMessage(resolveErrorMessage(result.error ?? "Unknown error"));
      }
    } catch (err) {
      setStatus("error");
      setMessage(resolveErrorMessage(err instanceof Error ? err.message : "Unknown error"));
    }
  }

  return (
    <div className="relative">
      {/* トリガーボタン */}
      <button
        className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-black shadow-lg transition ${
          status === "running"
            ? "border border-yellow-300/30 bg-yellow-300/10 text-yellow-200 opacity-80 cursor-not-allowed"
            : status === "done"
              ? "border border-emerald-300/30 bg-emerald-300/10 text-emerald-200"
              : "border border-sky-300/30 bg-sky-300/10 text-sky-100 hover:bg-sky-300/20"
        }`}
        disabled={status === "running"}
        onClick={() => setOpen((v) => !v)}
        type="button"
        title="OpenAIを使う手動AIジョブ"
      >
        <span className={status === "running" ? "animate-spin inline-block" : ""}>
          {status === "done" ? "✓" : "⚡"}
        </span>
        <span className="hidden sm:inline">
          {status === "running" ? "実行中…" : status === "done" ? "完了" : "手動AI"}
        </span>
      </button>

      {/* フローティングパネル */}
      {open && (
        <>
          {/* 背景クリックで閉じる */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-12 z-50 w-80 rounded-2xl border border-white/10 bg-slate-900 p-4 shadow-2xl shadow-black/60 ring-1 ring-white/5">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-black text-slate-50">⚡ Manual AI Job</p>
                <p className="mt-1 text-xs text-slate-400">
                  Watchlist全銘柄を今すぐ更新します。サーバーにOPENAI_API_KEYがある場合、この手動実行ではOpenAI分析を使います。
                </p>
              </div>
              <button
                className="text-slate-500 hover:text-slate-300"
                onClick={() => setOpen(false)}
              >
                ✕
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <div className="grid gap-2">
                <div className="rounded-xl border border-emerald-300/20 bg-emerald-300/10 px-3 py-2">
                  <p className="text-[11px] font-black uppercase tracking-[0.12em] text-emerald-200">Free Auto Updates</p>
                  <p className="mt-1 text-xs leading-5 text-emerald-50">毎朝の自動ジョブはOpenAIを使わず、株価・SEC EDGAR・IR系の無料更新を優先します。</p>
                </div>
                <div className="rounded-xl border border-amber-300/20 bg-amber-300/10 px-3 py-2">
                  <p className="text-[11px] font-black uppercase tracking-[0.12em] text-amber-200">Manual OpenAI</p>
                  <p className="mt-1 text-xs leading-5 text-amber-50">このボタンの手動実行は、OPENAI_API_KEY設定済みならOpenAI料金の対象です。</p>
                </div>
              </div>
              {/* CRON_SECRET入力（本番用） */}
              <input
                className="block w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-xs text-slate-50 placeholder-slate-600 outline-none focus:border-sky-300/50"
                placeholder="CRON_SECRET（APIキーではありません）"
                type="password"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void run(false); }}
              />
              <p className="text-[11px] leading-5 text-slate-500">
                ここにOpenAI APIキーやNews APIキーを入れても更新されません。本番の手動実行を許可する合言葉だけを入力します。
              </p>
              <div className="text-[11px] text-slate-500">
                対象: {userWatchlist.items.map((i) => i.stock.ticker).join(", ") || "（銘柄なし）"}
              </div>
              <div className="grid gap-2">
                <button
                  className="w-full rounded-xl border border-emerald-300/30 bg-emerald-300/10 py-2.5 text-sm font-black text-emerald-100 transition hover:bg-emerald-300/15 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={status === "running" || userWatchlist.items.length === 0}
                  onClick={() => void run(false)}
                  type="button"
                >
                  {status === "running" ? "実行中…" : "無料更新だけ実行"}
                </button>
                <button
                  className="w-full rounded-xl bg-sky-400 py-2.5 text-sm font-black text-slate-950 shadow-lg shadow-sky-950/30 transition hover:bg-sky-300 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={status === "running" || userWatchlist.items.length === 0}
                  onClick={() => void run(true)}
                  type="button"
                >
                  {status === "running" ? "実行中…" : "OpenAI分析も実行"}
                </button>
              </div>
            </div>

            {/* ステータスメッセージ */}
            {message && (
              <p className={`mt-3 rounded-xl border px-3 py-2 text-[11px] leading-5 ${
                status === "error"
                  ? "border-red-300/25 bg-red-400/10 text-red-100"
                  : status === "done"
                    ? "border-emerald-300/25 bg-emerald-300/10 text-emerald-100"
                    : "border-yellow-300/25 bg-yellow-300/10 text-yellow-100"
              }`}>
                {message}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function resolveErrorMessage(msg: string) {
  const l = msg.toLowerCase();
  if (l.includes("cron_secret") || l.includes("invalid") || l.includes("401")) {
    return "CRON_SECRETが違います。正しい値を入力してください。";
  }
  if (l.includes("login is required") || msg.includes("ログインが必要")) {
    return "手動AI Jobはログインが必要です。スマホでログインし直してから再実行してください。";
  }
  if (l.includes("quota") || l.includes("429") || l.includes("rate limit")) {
    return "APIの利用上限に達しています。時間を置いて再実行してください。";
  }
  if (l.includes("月間ai利用上限") || l.includes("本日の")) {
    return msg;
  }
  return `エラー: ${msg}`;
}
