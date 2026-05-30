import type { NewsItem } from "@/types";
import { StatusBadge } from "./StatusBadge";

export function NewsCard({ item, featured = false }: { item: NewsItem; featured?: boolean }) {
  const summary = parseSummary(item.summary);
  const tickerStyle = getTickerStyle(item.ticker);
  const sentimentStyle = {
    Positive: "ring-green-400/15",
    Neutral: "ring-slate-400/10",
    Negative: "ring-red-400/15"
  }[item.sentiment];

  return (
    <article className={`relative min-w-0 overflow-hidden rounded-2xl border bg-slate-900/80 p-3 shadow-lg shadow-black/20 ring-1 sm:p-4 ${tickerStyle.card} ${sentimentStyle} ${featured ? "lg:p-5" : ""}`}>
      <div className={`absolute inset-y-0 left-0 w-1.5 ${tickerStyle.rail}`} />
      <div className={`absolute right-3 top-3 rounded-full border px-2.5 py-1 text-[11px] font-black tracking-[0.14em] sm:right-4 sm:top-4 sm:px-3 sm:text-xs sm:tracking-[0.18em] ${tickerStyle.watermark}`}>
        {item.ticker}
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 pr-14 sm:pr-20">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <span className={`rounded-full border px-2.5 py-1 font-bold ${tickerStyle.badge}`}>
              {item.ticker} News
            </span>
            <span>{item.source}</span>
            <span className="text-slate-600">•</span>
            <span>{item.publishedAt}</span>
          </div>
          <h3 className={`mt-2 break-words font-semibold leading-6 text-slate-50 ${featured ? "text-base sm:text-lg" : "text-sm sm:text-base"}`}>
            {item.url ? (
              <a href={item.url} target="_blank" rel="noreferrer" className="hover:text-sky-200">
                {item.title}
              </a>
            ) : item.title}
          </h3>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${tickerStyle.impact}`}>
            Impact {item.impactScore}/10
          </span>
          <StatusBadge value={item.sentiment} />
        </div>
      </div>

      <div className={`mt-4 rounded-xl border bg-slate-950/50 p-3 ${tickerStyle.panel}`}>
        <p className={`text-xs font-semibold uppercase tracking-wide ${tickerStyle.label}`}>AI要点 / {item.ticker}</p>
        <p className="mt-2 text-sm leading-6 text-slate-100">{summary.point}</p>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <InfoBlock label="短期影響" value={summary.shortTerm} />
        <InfoBlock label="中期影響" value={summary.midTerm} />
      </div>

      <div className="mt-4 grid gap-3 text-xs text-slate-300 md:grid-cols-2">
        <div className="rounded-xl border border-red-400/15 bg-red-400/10 p-3">
          <p className="font-semibold text-red-300">リスク</p>
          <p className="mt-1 leading-5">{item.risk}</p>
        </div>
        <div className="rounded-xl border border-green-400/15 bg-green-400/10 p-3">
          <p className="font-semibold text-green-300">チャンス</p>
          <p className="mt-1 leading-5">{item.opportunity}</p>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-3 border-t border-white/10 pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs leading-5 text-slate-300">
          <span className="font-semibold text-sky-200">AIコメント:</span> {item.aiComment}
        </p>
        {item.url ? (
          <a className="inline-flex shrink-0 items-center justify-center rounded-full border border-sky-300/30 bg-sky-300/10 px-3 py-2 text-xs font-bold text-sky-200 hover:bg-sky-300/20" href={item.url} target="_blank" rel="noreferrer">
            ニュース本文を開く ↗
          </a>
        ) : null}
      </div>
    </article>
  );
}

function getTickerStyle(ticker: string) {
  if (ticker === "SIDU") {
    return {
      card: "border-amber-300/25 bg-[linear-gradient(135deg,rgba(245,158,11,0.10),rgba(15,23,42,0.88)_38%)]",
      rail: "bg-amber-400",
      badge: "border-amber-300/40 bg-amber-300/15 text-amber-100",
      impact: "border-amber-300/35 bg-amber-300/10 text-amber-100",
      panel: "border-amber-300/20",
      label: "text-amber-300",
      watermark: "border-amber-300/30 bg-amber-300/10 text-amber-100"
    };
  }

  return {
    card: "border-sky-300/25 bg-[linear-gradient(135deg,rgba(56,189,248,0.10),rgba(15,23,42,0.88)_38%)]",
    rail: "bg-sky-400",
    badge: "border-sky-300/40 bg-sky-300/15 text-sky-100",
    impact: "border-sky-300/35 bg-sky-300/10 text-sky-100",
    panel: "border-sky-300/20",
    label: "text-sky-300",
    watermark: "border-sky-300/30 bg-sky-300/10 text-sky-100"
  };
}

function InfoBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-950/45 p-3">
      <p className="text-xs font-semibold text-slate-400">{label}</p>
      <p className="mt-1 text-sm leading-6 text-slate-200">{value}</p>
    </div>
  );
}

function parseSummary(summary: string) {
  const getValue = (label: string) => {
    const match = summary.match(new RegExp(`${label}:\\s*([^\\n]+)`));
    return match?.[1]?.trim() ?? "";
  };
  return {
    point: getValue("要点") || summary.split("\n")[0] || "ニュース内容を確認中です。",
    shortTerm: getValue("短期影響") || "短期の株価反応は出来高と価格推移を確認してください。",
    midTerm: getValue("中期影響") || "中期では業績・資金調達・提携などの継続材料を確認してください。"
  };
}
