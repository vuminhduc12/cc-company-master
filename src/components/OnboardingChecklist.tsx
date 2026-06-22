"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAiJobResult } from "@/lib/use-ai-job-result";
import { useSupabaseAuth } from "@/lib/use-supabase-auth";
import { useUserWatchlist } from "@/lib/user-watchlist";

const STORAGE_KEY = "dfinance.onboarding.dismissed.v1";

type Step = {
  id: string;
  title: string;
  description: string;
  done: boolean;
  href: string;
  cta: string;
};

export function OnboardingChecklist() {
  const auth = useSupabaseAuth();
  const userWatchlist = useUserWatchlist();
  const jobResult = useAiJobResult();
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    setDismissed(localStorage.getItem(STORAGE_KEY) === "1");
  }, []);

  const steps: Step[] = [
    {
      id: "login",
      title: "アカウントにログイン",
      description: "Watchlistとプランを保存し、AI診断を利用できます。",
      done: Boolean(auth.user),
      href: "/settings",
      cta: "ログイン"
    },
    {
      id: "watchlist",
      title: "監視したい銘柄を追加",
      description: "気になる銘柄をWatchlistに登録すると分析対象になります。",
      done: userWatchlist.items.length > 0,
      href: "/watchlist",
      cta: "銘柄を追加"
    },
    {
      id: "ai",
      title: "AI分析を実行",
      description: "最新の株価・ニュースを取り込み、スコアと注目度を算出します。",
      done: Boolean(jobResult?.lastRun),
      href: "/settings",
      cta: "AIを実行"
    }
  ];

  const doneCount = steps.filter((step) => step.done).length;
  const allDone = doneCount === steps.length;

  if (dismissed || allDone) return null;

  const nextStep = steps.find((step) => !step.done);

  function dismiss() {
    localStorage.setItem(STORAGE_KEY, "1");
    setDismissed(true);
  }

  return (
    <section className="rounded-2xl border border-teal-300/25 bg-gradient-to-br from-teal-300/[0.08] to-slate-950/60 p-5 shadow-xl shadow-black/20 ring-1 ring-white/5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-teal-200">Getting Started</p>
          <h2 className="mt-1 text-lg font-bold text-slate-50">3ステップで使い始める</h2>
          <p className="mt-1 text-xs text-slate-400">{doneCount} / {steps.length} 完了</p>
        </div>
        <button className="text-xs font-semibold text-slate-500 hover:text-slate-300" onClick={dismiss} type="button">
          閉じる
        </button>
      </div>

      <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full bg-teal-300 transition-all" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
      </div>

      <ol className="mt-4 space-y-2">
        {steps.map((step) => (
          <li
            key={step.id}
            className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${
              step.done ? "border-emerald-300/25 bg-emerald-300/[0.06]" : "border-white/10 bg-white/[0.04]"
            }`}
          >
            <span
              className={`grid size-6 shrink-0 place-items-center rounded-full text-xs font-black ${
                step.done ? "bg-emerald-300 text-slate-950" : "border border-white/20 text-slate-400"
              }`}
            >
              {step.done ? "✓" : ""}
            </span>
            <span className="min-w-0 flex-1">
              <span className={`block text-sm font-bold ${step.done ? "text-slate-400 line-through" : "text-slate-100"}`}>
                {step.title}
              </span>
              <span className="mt-0.5 block text-xs text-slate-500">{step.description}</span>
            </span>
            {!step.done && nextStep?.id === step.id ? (
              <Link
                className="shrink-0 rounded-lg border border-teal-300/30 bg-teal-300/10 px-3 py-1.5 text-xs font-black text-teal-100 hover:bg-teal-300/20"
                href={step.href}
              >
                {step.cta}
              </Link>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
