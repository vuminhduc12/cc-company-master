import type { NewsItem } from "@/types";
import { StatusBadge } from "./StatusBadge";

export function NewsCard({ item, featured = false, onDelete }: { item: NewsItem; featured?: boolean; onDelete?: (item: NewsItem) => void }) {
  const summary = parseSummary(item.summary);
  const tickerStyle = getTickerStyle(item.ticker);
  const sentimentUi = getSentimentUi(item.sentiment);
  const impactUi = getImpactUi(item.impactScore);
  const sentimentStyle = {
    Positive: "ring-green-400/15",
    Neutral: "ring-slate-400/10",
    Negative: "ring-red-400/15"
  }[item.sentiment];

  return (
    <article className={`relative min-w-0 overflow-hidden rounded-2xl border bg-slate-900/80 shadow-lg shadow-black/20 ring-1 ${tickerStyle.card} ${sentimentStyle}`}>
      <div className={`absolute inset-y-0 left-0 w-1.5 ${tickerStyle.rail}`} />
      <div className="grid min-w-0 gap-0 md:grid-cols-[112px_minmax(0,1fr)]">
        <div className={`border-b border-white/10 p-4 md:border-b-0 md:border-r ${tickerStyle.side}`}>
          <p className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-400">Ticker</p>
          <p className={`mt-2 text-3xl font-black tracking-tight ${tickerStyle.tickerText}`}>{item.ticker}</p>
          <div className="mt-3 flex flex-wrap gap-1.5 md:flex-col">
            <span className={`w-fit rounded-full border px-2 py-1 text-[10px] font-black ${sentimentUi.badge}`}>{sentimentUi.label}</span>
            <span className={`w-fit rounded-full border px-2 py-1 text-[10px] font-black ${impactUi.badge}`}>{impactUi.label}</span>
          </div>
        </div>

        <div className={`min-w-0 p-3 sm:p-4 ${featured ? "lg:p-5" : ""}`}>
          <div className="flex min-w-0 flex-col gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                <span className={`rounded-full border px-2.5 py-1 font-bold ${tickerStyle.badge}`}>
                  {item.ticker} News
                </span>
                <span className={`rounded-full border px-2.5 py-1 font-black ${impactUi.badge}`}>
                  重要度 {item.impactScore}/10
                </span>
                <span className="break-words [overflow-wrap:anywhere]">{item.source}</span>
                <span className="text-slate-600">•</span>
                <span>{item.publishedAt}</span>
              </div>
              <h3 className={`mt-2 break-words font-semibold leading-6 text-slate-50 [overflow-wrap:anywhere] ${featured ? "text-base sm:text-lg" : "text-sm sm:text-base"}`}>
                {item.url ? (
                  <a href={item.url} target="_blank" rel="noreferrer" className="hover:text-sky-200">
                    {item.title}
                  </a>
                ) : item.title}
              </h3>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${tickerStyle.impact}`}>
                Impact {item.impactScore}/10
              </span>
              <StatusBadge value={item.sentiment} />
            </div>
          </div>

          <div className={`mt-4 rounded-xl border bg-slate-950/50 p-3 ${tickerStyle.panel}`}>
            <p className={`text-xs font-semibold uppercase tracking-wide ${tickerStyle.label}`}>最重要ポイント / {item.ticker}</p>
            <p className="mt-2 break-words text-sm leading-6 text-slate-100 [overflow-wrap:anywhere]">{summary.point}</p>
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <InfoBlock label="短期影響" value={summary.shortTerm} />
            <InfoBlock label="中期影響" value={summary.midTerm} />
          </div>

          <div className="mt-4 grid gap-3 text-xs text-slate-300 md:grid-cols-2">
            <div className="rounded-xl border border-red-400/15 bg-red-400/10 p-3">
              <p className="font-semibold text-red-300">注意材料</p>
              <p className="mt-1 break-words leading-5 [overflow-wrap:anywhere]">{item.risk}</p>
            </div>
            <div className="rounded-xl border border-green-400/15 bg-green-400/10 p-3">
              <p className="font-semibold text-green-300">上昇材料</p>
              <p className="mt-1 break-words leading-5 [overflow-wrap:anywhere]">{item.opportunity}</p>
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-3 border-t border-white/10 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="break-words text-xs leading-5 text-slate-300 [overflow-wrap:anywhere]">
              <span className="font-semibold text-sky-200">AIコメント:</span> {item.aiComment}
            </p>
            {item.url ? (
              <a className="inline-flex shrink-0 items-center justify-center rounded-full border border-sky-300/30 bg-sky-300/10 px-3 py-2 text-xs font-bold text-sky-200 hover:bg-sky-300/20" href={item.url} target="_blank" rel="noreferrer">
                本文 ↗
              </a>
            ) : null}
            {onDelete ? (
              <button
                className="inline-flex shrink-0 items-center justify-center rounded-full border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs font-bold text-red-200 hover:bg-red-400/20"
                onClick={() => onDelete(item)}
                type="button"
              >
                削除
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}

function getTickerStyle(ticker: string) {
  if (ticker === "SIDU") {
    return {
      card: "border-amber-300/25 bg-[linear-gradient(135deg,rgba(245,158,11,0.10),rgba(15,23,42,0.88)_38%)]",
      rail: "bg-amber-400",
      side: "bg-amber-300/[0.06]",
      tickerText: "text-amber-100",
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
    side: "bg-sky-300/[0.06]",
    tickerText: "text-sky-100",
    badge: "border-sky-300/40 bg-sky-300/15 text-sky-100",
    impact: "border-sky-300/35 bg-sky-300/10 text-sky-100",
    panel: "border-sky-300/20",
    label: "text-sky-300",
    watermark: "border-sky-300/30 bg-sky-300/10 text-sky-100"
  };
}

function getSentimentUi(sentiment: NewsItem["sentiment"]) {
  return {
    Positive: { label: "好材料", badge: "border-green-300/35 bg-green-300/10 text-green-100" },
    Neutral: { label: "中立", badge: "border-slate-300/25 bg-slate-300/10 text-slate-200" },
    Negative: { label: "悪材料", badge: "border-red-300/35 bg-red-300/10 text-red-100" }
  }[sentiment];
}

function getImpactUi(score: number) {
  if (score >= 8) return { label: "最重要", badge: "border-red-300/40 bg-red-300/15 text-red-100" };
  if (score >= 6) return { label: "重要", badge: "border-yellow-300/40 bg-yellow-300/15 text-yellow-100" };
  return { label: "通常", badge: "border-slate-300/25 bg-slate-300/10 text-slate-200" };
}

function InfoBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-950/45 p-3">
      <p className="text-xs font-semibold text-slate-400">{label}</p>
      <p className="mt-1 break-words text-sm leading-6 text-slate-200 [overflow-wrap:anywhere]">{value}</p>
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
