"use client";

import { useState } from "react";
import { authHeaders } from "@/lib/auth-fetch";
import { paidPlanKeys, planDefinitions, type PlanKey } from "@/lib/plans";
import { useSupabaseAuth } from "@/lib/use-supabase-auth";

export function PlanUpgradePanel({ currentPlan }: { currentPlan?: PlanKey }) {
  const auth = useSupabaseAuth();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function startCheckout(plan: PlanKey) {
    setBusy(plan);
    setError("");
    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ plan })
      });
      const data = await response.json() as { ok: boolean; url?: string; error?: string };
      if (!data.ok || !data.url) throw new Error(data.error ?? "Checkoutを開始できませんでした。");
      window.location.href = data.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Checkoutを開始できませんでした。");
      setBusy(null);
    }
  }

  async function openPortal() {
    setBusy("portal");
    setError("");
    try {
      const response = await fetch("/api/billing/portal", {
        method: "POST",
        headers: { "content-type": "application/json", ...(await authHeaders()) }
      });
      const data = await response.json() as { ok: boolean; url?: string; error?: string };
      if (!data.ok || !data.url) throw new Error(data.error ?? "プラン管理ページを開けませんでした。");
      window.location.href = data.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "プラン管理ページを開けませんでした。");
      setBusy(null);
    }
  }

  if (!auth.loading && !auth.user) {
    return (
      <section className="rounded-2xl border border-sky-300/20 bg-slate-900/80 p-5 text-sm text-slate-300 shadow-xl shadow-black/20 ring-1 ring-white/5">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-300">Upgrade</p>
        <h3 className="mt-2 text-lg font-semibold text-slate-50">プランのアップグレード</h3>
        <p className="mt-2 leading-6 text-slate-400">
          アップグレードと有料機能のご利用にはログインが必要です。上のUser Accountからログインしてください。
        </p>
      </section>
    );
  }

  const isPaid = currentPlan === "pro" || currentPlan === "premium";

  return (
    <section className="rounded-2xl border border-sky-300/20 bg-slate-900/80 p-5 shadow-xl shadow-black/20 ring-1 ring-white/5">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-300">Upgrade</p>
          <h3 className="mt-2 text-lg font-semibold text-slate-50">プランのアップグレード</h3>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            Stripeの安全な決済ページに移動します。解約・支払い方法の変更は「プラン管理」から行えます。
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {paidPlanKeys.map((key) => {
          const plan = planDefinitions[key];
          const isCurrent = currentPlan === key;
          return (
            <button
              key={key}
              className="flex items-center justify-between rounded-xl border border-sky-300/30 bg-sky-300/10 px-4 py-3 text-left text-sm font-bold text-sky-100 transition hover:bg-sky-300/20 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={busy !== null || isCurrent}
              onClick={() => void startCheckout(key)}
              type="button"
            >
              <span>
                <span className="block">{isCurrent ? `${plan.name}（利用中）` : `${plan.name}にアップグレード`}</span>
                <span className="mt-0.5 block text-xs font-semibold text-sky-200/70">¥{plan.monthlyPriceJpy.toLocaleString("ja-JP")} / 月</span>
              </span>
              <span>{busy === key ? "…" : "→"}</span>
            </button>
          );
        })}
      </div>

      {isPaid ? (
        <button
          className="mt-3 w-full rounded-xl border border-white/10 bg-white/[0.06] px-4 py-2.5 text-sm font-bold text-slate-100 transition hover:bg-white/[0.12] disabled:opacity-50"
          disabled={busy !== null}
          onClick={() => void openPortal()}
          type="button"
        >
          {busy === "portal" ? "開いています…" : "プラン管理（解約・支払い方法）"}
        </button>
      ) : null}

      {error ? (
        <p className="mt-3 rounded-xl border border-red-300/25 bg-red-400/10 px-3 py-2 text-xs leading-5 text-red-100">{error}</p>
      ) : null}
    </section>
  );
}
