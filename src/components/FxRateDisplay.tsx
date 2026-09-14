"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type FxRate = {
  rate: number;
  asOf: string;
  source: string;
  stale: boolean;
  updateFailed: boolean;
};
type FxState = { data: FxRate | null; loading: boolean; error: boolean };
const FxContext = createContext<FxState>({ data: null, loading: true, error: false });

export function FxRateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<FxState>({ data: null, loading: true, error: false });
  useEffect(() => {
    let disposed = false;
    let pending = false;
    let controller: AbortController | null = null;
    async function refresh() {
      if (pending || document.visibilityState === "hidden") return;
      pending = true;
      controller = new AbortController();
      const timeout = window.setTimeout(() => controller?.abort(), 15000);
      try {
        const response = await fetch("/api/fx/usd-jpy", { cache: "no-store", signal: controller.signal });
        const data = await response.json();
        if (!response.ok || !data.ok || !Number.isFinite(data.rate) || data.rate <= 0
          || typeof data.asOf !== "string" || typeof data.source !== "string") throw new Error("FX unavailable");
        if (!disposed) setState({ data, loading: false, error: false });
      } catch {
        if (!disposed) setState((previous) => ({ ...previous, loading: false, error: true }));
      } finally {
        window.clearTimeout(timeout);
        pending = false;
      }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5 * 60 * 1000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      disposed = true;
      controller?.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  return <FxContext.Provider value={state}>{children}</FxContext.Provider>;
}

export function FxRateDisplay({ compact = false }: { compact?: boolean }) {
  const { data, loading, error } = useContext(FxContext);
  const warning = error || data?.stale || data?.updateFailed;
  const status = loading ? "取得中" : !data ? "取得できません"
    : error || data.updateFailed ? "更新失敗・保存値" : data.stale ? "更新遅延・保存値" : "日次基準";
  const rate = data ? `${data.rate.toLocaleString("ja-JP", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} 円` : "-- 円";
  return (
    <section aria-label={compact ? "ヘッダーのドル円" : "ドル円の基準レート"}
      className={compact ? "min-w-0 text-xs" : "flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-y border-white/10 py-3"}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-xs font-semibold text-slate-400">USD/JPY{compact ? "" : " · ドル円"}</span>
        <span className={`${compact ? "text-sm" : "text-xl"} min-w-[7rem] font-bold tabular-nums text-slate-50`} aria-live="polite">{rate}</span>
      </div>
      <div className={`${compact ? "mt-1" : ""} flex flex-wrap gap-x-3 gap-y-1 text-[11px]`}>
        <span className={warning ? "text-amber-300" : "text-slate-400"}>{status}</span>
        {data ? <span className="text-slate-400">基準日 <time dateTime={data.asOf}>{data.asOf}</time></span> : null}
        {!compact && data ? <span className="text-slate-400">{data.source}</span> : null}
      </div>
    </section>
  );
}
