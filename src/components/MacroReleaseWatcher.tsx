"use client";

import { useEffect, useState } from "react";

type MacroMetric = {
  id: string;
  label: string;
  value: number | null;
  date: string;
};

type MacroOutlook = {
  scenario: "risk_on" | "range" | "risk_off";
  score: number;
  summary: string;
  metrics: MacroMetric[];
  fedPolicy: {
    date: string;
    stance: "easing" | "neutral" | "tightening";
    summary: string;
  } | null;
  generatedAt: string;
};

const macroReleaseSignatureKey = "d-finance-macro-release-signature";
const watchedMetricIds = ["CPIAUCSL", "CPILFESL", "FEDFUNDS", "DFEDTARL", "DFEDTARU", "DGS10", "DGS2", "VIXCLS", "SP500"];

export function MacroReleaseWatcher() {
  const [alert, setAlert] = useState<MacroOutlook | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function checkMacroRelease() {
      try {
        const response = await fetch("/api/macro/market-outlook?ai=0", { cache: "no-store" });
        const payload = await response.json() as { ok: true; outlook: MacroOutlook } | { ok: false };
        if (cancelled || !response.ok || !payload.ok) return;

        const signature = macroSignature(payload.outlook);
        const previous = localStorage.getItem(macroReleaseSignatureKey);
        localStorage.setItem(macroReleaseSignatureKey, signature);
        if (previous && previous !== signature) {
          setAlert(payload.outlook);
        }
      } catch {
        // Macro release notifications are best-effort. The dashboard panel still fetches independently.
      }
    }

    void checkMacroRelease();
    const timer = window.setInterval(checkMacroRelease, 30 * 60 * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  if (!alert) return null;

  return (
    <div className="fixed inset-x-3 bottom-24 z-50 mx-auto max-w-lg rounded-2xl border border-sky-300/25 bg-neutral-950/95 p-4 shadow-2xl shadow-black/50 ring-1 ring-white/10 backdrop-blur md:bottom-5 md:right-5 md:left-auto md:mx-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-sky-200">Macro Update</p>
          <h3 className="mt-1 text-base font-black text-white">米国マクロ指標を更新しました</h3>
          <p className="mt-2 text-sm leading-6 text-slate-300">{alert.summary}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="rounded-full border border-white/10 bg-white/[0.06] px-2.5 py-1 text-[11px] font-black text-slate-200">{scenarioLabel(alert.scenario)}</span>
            <span className="rounded-full border border-sky-300/25 bg-sky-300/10 px-2.5 py-1 text-[11px] font-black text-sky-100">Score {alert.score}</span>
            {alert.fedPolicy ? <span className="rounded-full border border-amber-300/25 bg-amber-300/10 px-2.5 py-1 text-[11px] font-black text-amber-100">FOMC {alert.fedPolicy.date}</span> : null}
          </div>
        </div>
        <button
          aria-label="マクロ更新通知を閉じる"
          className="grid size-8 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/[0.05] text-slate-400 transition hover:bg-white/[0.1] hover:text-slate-100"
          onClick={() => setAlert(null)}
          type="button"
        >
          x
        </button>
      </div>
    </div>
  );
}

function macroSignature(outlook: MacroOutlook) {
  const metricSignature = outlook.metrics
    .filter((metric) => watchedMetricIds.includes(metric.id))
    .map((metric) => `${metric.id}:${metric.date}:${metric.value ?? "-"}`)
    .sort()
    .join("|");
  return [
    metricSignature,
    `fed:${outlook.fedPolicy?.date ?? "-"}:${outlook.fedPolicy?.stance ?? "-"}`,
    `scenario:${outlook.scenario}:${outlook.score}`
  ].join(";");
}

function scenarioLabel(scenario: MacroOutlook["scenario"]) {
  if (scenario === "risk_on") return "Risk-On";
  if (scenario === "risk_off") return "Risk-Off";
  return "Range";
}
