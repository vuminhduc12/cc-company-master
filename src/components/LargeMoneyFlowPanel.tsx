import { analyzeLargeMoneyFlow } from "@/lib/large-money-flow";
import type { DailyPrice, NewsItem } from "@/types";

export function LargeMoneyFlowPanel({
  prices,
  news,
  compact = false
}: {
  prices: DailyPrice[];
  news: NewsItem[];
  compact?: boolean;
}) {
  const signal = analyzeLargeMoneyFlow(prices, news);
  const tone = phaseTone(signal.phase);

  return (
    <section className={`rounded-2xl border p-4 shadow-xl shadow-black/20 ring-1 ring-white/5 ${tone.panel}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className={`text-xs font-black uppercase tracking-[0.18em] ${tone.eyebrow}`}>Large Money Flow</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-black text-slate-50">大口資金シグナル</h3>
            <span className={`rounded-full border px-2.5 py-1 text-[11px] font-black ${tone.badge}`}>{signal.phase}</span>
            <span className="rounded-full border border-white/10 bg-black/25 px-2.5 py-1 text-[11px] font-bold text-slate-300">信頼度 {signal.confidence}</span>
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-300">{signal.summary}</p>
        </div>
        <div className={`grid min-w-[112px] place-items-center rounded-xl border px-4 py-3 ${tone.score}`}>
          <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">Signal</p>
          <p className="mt-1 text-3xl font-black text-white tabular-nums">{signal.score}</p>
        </div>
      </div>

      {!compact ? (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <SignalList title="検知根拠" items={signal.evidence} empty="強い資金流入根拠はまだ限定的です。" tone="positive" />
          <SignalList title="注意点" items={signal.warnings} empty="明確な売り抜け警戒シグナルは限定的です。" tone="warning" />
        </div>
      ) : null}
      <p className="mt-3 text-[11px] leading-5 text-slate-500">
        公開OHLCVからの推定です。実際の機関投資家売買や約定主体を断定するものではありません。
      </p>
    </section>
  );
}

function SignalList({ title, items, empty, tone }: { title: string; items: string[]; empty: string; tone: "positive" | "warning" }) {
  return (
    <div className={tone === "positive" ? "rounded-xl border border-emerald-300/18 bg-emerald-300/[0.055] p-3" : "rounded-xl border border-amber-300/18 bg-amber-300/[0.055] p-3"}>
      <p className={tone === "positive" ? "text-xs font-black text-emerald-100" : "text-xs font-black text-amber-100"}>{title}</p>
      <ul className="mt-2 space-y-1 text-xs leading-5 text-slate-300">
        {(items.length ? items : [empty]).map((item) => <li key={item}>・{item}</li>)}
      </ul>
    </div>
  );
}

function phaseTone(phase: ReturnType<typeof analyzeLargeMoneyFlow>["phase"]) {
  if (phase === "Breakout") {
    return {
      panel: "border-sky-300/20 bg-sky-300/[0.06]",
      eyebrow: "text-sky-200",
      badge: "border-sky-300/35 bg-sky-300/10 text-sky-100",
      score: "border-sky-300/25 bg-sky-300/10"
    };
  }
  if (phase === "Accumulation") {
    return {
      panel: "border-emerald-300/20 bg-emerald-300/[0.055]",
      eyebrow: "text-emerald-200",
      badge: "border-emerald-300/35 bg-emerald-300/10 text-emerald-100",
      score: "border-emerald-300/25 bg-emerald-300/10"
    };
  }
  if (phase === "Distribution") {
    return {
      panel: "border-rose-300/20 bg-rose-300/[0.06]",
      eyebrow: "text-rose-200",
      badge: "border-rose-300/35 bg-rose-300/10 text-rose-100",
      score: "border-rose-300/25 bg-rose-300/10"
    };
  }
  return {
    panel: "border-white/10 bg-slate-900/75",
    eyebrow: "text-slate-400",
    badge: "border-white/10 bg-white/[0.06] text-slate-300",
    score: "border-white/10 bg-white/[0.05]"
  };
}
