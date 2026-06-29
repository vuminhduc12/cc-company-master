"use client";

import { useEffect, useState } from "react";
import { authHeaders } from "@/lib/auth-fetch";

type MacroMetric = {
  id: string;
  label: string;
  value: number | null;
  previous: number | null;
  change: number | null;
  unit: string;
  date: string;
  source: string;
};

type MacroMarketOutlook = {
  scenario: "risk_on" | "range" | "risk_off";
  confidence: "低" | "中" | "高";
  score: number;
  summary: string;
  drivers: string[];
  risks: string[];
  metrics: MacroMetric[];
  fedPolicy: {
    lowerBound: number | null;
    upperBound: number | null;
    midpoint: number | null;
    effectiveRate: number | null;
    monthlyChange: number | null;
    stance: "easing" | "neutral" | "tightening";
    date: string;
    summary: string;
  } | null;
  generatedAt: string;
  dataSource: string;
  aiComment?: string;
  warning?: string;
};

export function MacroMarketPanel() {
  const [outlook, setOutlook] = useState<MacroMarketOutlook | null>(null);
  const [status, setStatus] = useState<"loading" | "done" | "error">("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function loadOutlook() {
      setStatus("loading");
      setError("");
      try {
        const response = await fetch("/api/macro/market-outlook", {
          cache: "no-store",
          headers: await authHeaders()
        });
        const payload = await response.json() as { ok: true; outlook: MacroMarketOutlook } | { ok: false; error?: string };
        if (cancelled) return;
        if (!response.ok || !payload.ok) {
          setStatus("error");
          setError("error" in payload ? payload.error ?? "マクロ見通しを取得できませんでした。" : "マクロ見通しを取得できませんでした。");
          return;
        }
        setOutlook(payload.outlook);
        setStatus("done");
      } catch (err) {
        if (!cancelled) {
          setStatus("error");
          setError(err instanceof Error ? err.message : "マクロ見通しを取得できませんでした。");
        }
      }
    }
    void loadOutlook();
    const timer = window.setInterval(loadOutlook, 30 * 60 * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const scenario = outlook?.scenario ?? "range";
  const tone = scenarioTone(scenario);
  const coreMetrics = ["CPIAUCSL", "CPILFESL", "FEDFUNDS", "DGS10", "VIXCLS", "SP500"]
    .map((id) => outlook?.metrics.find((metric) => metric.id === id))
    .filter((metric): metric is MacroMetric => Boolean(metric));

  return (
    <section className={`overflow-hidden rounded-2xl border p-5 shadow-xl shadow-black/25 ring-1 ring-white/5 ${tone.panel}`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className={`text-xs font-black uppercase tracking-[0.2em] ${tone.eyebrow}`}>US Macro Pulse</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h2 className="text-2xl font-black tracking-tight text-white">CPI・金利・VIX 市場見通し</h2>
            <span className={`rounded-full border px-3 py-1 text-xs font-black ${tone.badge}`}>{scenarioLabel(scenario)}</span>
            {outlook ? <span className="rounded-full border border-white/10 bg-black/25 px-3 py-1 text-xs font-bold text-slate-300">信頼度 {outlook.confidence}</span> : null}
          </div>
          <p className="mt-3 max-w-4xl text-sm leading-6 text-slate-300">
            {status === "loading" ? "米国マクロ指標を取得中です。" : status === "error" ? error : outlook?.summary}
          </p>
          {outlook?.aiComment ? <p className="mt-3 max-w-4xl text-sm leading-6 text-slate-100">{outlook.aiComment}</p> : null}
          {outlook?.warning ? <p className="mt-2 text-xs leading-5 text-amber-200">{outlook.warning}</p> : null}
        </div>
        <div className={`grid min-w-[150px] place-items-center rounded-2xl border px-5 py-4 ${tone.score}`}>
          <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-300">Macro Score</p>
          <p className="mt-1 text-4xl font-black text-white tabular-nums">{outlook?.score ?? "--"}</p>
          <p className="mt-1 text-xs font-semibold text-slate-400">0-100</p>
        </div>
      </div>

      {outlook?.fedPolicy ? (
        <div className="mt-5 rounded-xl border border-white/10 bg-black/25 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">FOMC Policy Rate</p>
              <p className="mt-1 text-sm leading-6 text-slate-200">{outlook.fedPolicy.summary}</p>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <PolicyMini label="下限" value={formatPercent(outlook.fedPolicy.lowerBound)} />
              <PolicyMini label="上限" value={formatPercent(outlook.fedPolicy.upperBound)} />
              <PolicyMini label="変化" value={outlook.fedPolicy.monthlyChange === null ? "-" : `${outlook.fedPolicy.monthlyChange >= 0 ? "+" : ""}${outlook.fedPolicy.monthlyChange.toFixed(2)}pt`} />
            </div>
          </div>
        </div>
      ) : null}

      <div className="mt-5 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        {coreMetrics.map((metric) => <MacroMetricTile key={metric.id} metric={metric} />)}
        {!coreMetrics.length && status === "loading" ? Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="h-[104px] animate-pulse rounded-xl border border-white/10 bg-white/[0.05]" />
        )) : null}
      </div>

      {outlook ? (
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <MacroList title="市場を動かす材料" items={outlook.drivers} tone="driver" />
          <MacroList title="注意リスク" items={outlook.risks} tone="risk" />
        </div>
      ) : null}
    </section>
  );
}

function PolicyMini({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-[72px] rounded-lg border border-white/10 bg-white/[0.05] px-3 py-2">
      <p className="text-[10px] font-black text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-black text-slate-100 tabular-nums">{value}</p>
    </div>
  );
}

function MacroMetricTile({ metric }: { metric: MacroMetric }) {
  const positive = (metric.change ?? 0) >= 0;
  return (
    <div className="min-w-0 rounded-xl border border-white/10 bg-black/25 p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">{metric.label}</p>
        <span className={positive ? "text-xs font-black text-emerald-300" : "text-xs font-black text-rose-300"}>
          {metric.change === null ? "-" : `${positive ? "+" : ""}${metric.change.toFixed(2)}`}
        </span>
      </div>
      <p className="mt-2 truncate text-2xl font-black text-slate-50 tabular-nums">{formatMetric(metric)}</p>
      <p className="mt-1 truncate text-xs text-slate-500">{metric.date} / {metric.source}</p>
    </div>
  );
}

function MacroList({ title, items, tone }: { title: string; items: string[]; tone: "driver" | "risk" }) {
  return (
    <div className={tone === "driver" ? "rounded-xl border border-teal-300/20 bg-teal-300/[0.06] p-4" : "rounded-xl border border-amber-300/20 bg-amber-300/[0.06] p-4"}>
      <p className={tone === "driver" ? "text-xs font-black uppercase tracking-[0.16em] text-teal-200" : "text-xs font-black uppercase tracking-[0.16em] text-amber-200"}>{title}</p>
      <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-200">
        {items.map((item, index) => <li key={`${item}-${index}`}>・{item}</li>)}
      </ul>
    </div>
  );
}

function scenarioTone(scenario: MacroMarketOutlook["scenario"]) {
  if (scenario === "risk_on") {
    return {
      panel: "border-emerald-300/20 bg-[linear-gradient(135deg,rgba(6,78,59,0.38),rgba(2,6,23,0.92))]",
      eyebrow: "text-emerald-200",
      badge: "border-emerald-300/35 bg-emerald-300/10 text-emerald-100",
      score: "border-emerald-300/25 bg-emerald-300/10"
    };
  }
  if (scenario === "risk_off") {
    return {
      panel: "border-rose-300/20 bg-[linear-gradient(135deg,rgba(127,29,29,0.34),rgba(2,6,23,0.92))]",
      eyebrow: "text-rose-200",
      badge: "border-rose-300/35 bg-rose-300/10 text-rose-100",
      score: "border-rose-300/25 bg-rose-300/10"
    };
  }
  return {
    panel: "border-sky-300/20 bg-[linear-gradient(135deg,rgba(12,74,110,0.30),rgba(2,6,23,0.92))]",
    eyebrow: "text-sky-200",
    badge: "border-sky-300/35 bg-sky-300/10 text-sky-100",
    score: "border-sky-300/25 bg-sky-300/10"
  };
}

function scenarioLabel(scenario: MacroMarketOutlook["scenario"]) {
  if (scenario === "risk_on") return "Risk-On";
  if (scenario === "risk_off") return "Risk-Off";
  return "Range";
}

function formatMetric(metric: MacroMetric) {
  if (metric.value === null) return "-";
  return `${metric.value.toFixed(metric.value >= 100 ? 0 : 2)}${metric.unit}`;
}

function formatPercent(value: number | null) {
  return value === null ? "-" : `${value.toFixed(2)}%`;
}
