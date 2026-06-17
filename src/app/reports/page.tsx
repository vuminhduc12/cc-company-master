"use client";

import { LiveWatchlistStrip } from "@/components/LiveWatchlistStrip";
import { NewsCard } from "@/components/NewsCard";
import { HeaderPill, PageHeader } from "@/components/PageHeader";
import { news, report } from "@/lib/mock-data";
import { countStaleNews, filterFreshNews, freshNewsWindowDays } from "@/lib/news-freshness";
import { useAiJobResult } from "@/lib/use-ai-job-result";

export default function ReportsPage() {
  const jobResult = useAiJobResult();
  const currentReport = jobResult?.report ?? report;
  const allReportNews = jobResult?.news ?? news;
  const reportNews = filterFreshNews(allReportNews);
  const staleNewsCount = countStaleNews(allReportNews);
  const positiveNews = reportNews.filter((item) => item.sentiment === "Positive").length;
  const negativeNews = reportNews.filter((item) => item.sentiment === "Negative").length;
  const highImpactNews = reportNews.filter((item) => item.impactScore >= 8).length;
  const averageImpact = reportNews.length ? reportNews.reduce((sum, item) => sum + item.impactScore, 0) / reportNews.length : 0;
  const tickerSummaries = summarizeByTicker(reportNews);
  const conclusion = firstMeaningfulLine(currentReport.decision);
  const tomorrowFocus = firstMeaningfulLine(currentReport.tomorrow);
  const rows = [
    ["市場全体の雰囲気", currentReport.market, "blue"],
    ["監視銘柄の状態", currentReport.watchlist, "green"],
    ["AI総合判断", currentReport.decision, "gold"],
    ["明日の戦略", currentReport.tomorrow, "red"]
  ];

  return (
    <div className="space-y-5">
      <LiveWatchlistStrip />
      <PageHeader
        eyebrow="Daily Briefing"
        title="AI日次レポート"
        description="結論、明日の確認点、重要ニュースを優先表示します。"
        actions={(
          <>
            <HeaderPill label={jobResult ? `最終AI分析 ${jobResult.lastRun}` : "mock-data"} tone={jobResult ? "green" : "yellow"} />
            <HeaderPill label={jobResult ? "Supabase" : "Local"} />
          </>
        )}
      />

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(280px,0.7fr)]">
        <div className="rounded-3xl border border-sky-300/20 bg-sky-300/[0.07] p-5 shadow-xl shadow-black/25 ring-1 ring-white/5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-sky-300">Executive Summary</p>
              <h3 className="mt-2 break-words text-2xl font-black leading-8 text-slate-50 [overflow-wrap:anywhere]">{conclusion}</h3>
              <p className="mt-3 break-words border-l-2 border-sky-300/40 pl-3 text-sm leading-6 text-slate-300 [overflow-wrap:anywhere]">
                明日の優先確認: {tomorrowFocus}
              </p>
            </div>
            <div className="grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2">
              <SignalBox label="重要News" value={`${highImpactNews}`} tone={highImpactNews ? "red" : "default"} />
              <SignalBox label="好材料" value={`${positiveNews}`} tone="green" />
              <SignalBox label="悪材料" value={`${negativeNews}`} tone={negativeNews ? "red" : "default"} />
              <SignalBox label="平均影響" value={averageImpact.toFixed(1)} tone="blue" />
            </div>
          </div>
        </div>

        <div className="rounded-3xl border border-white/10 bg-slate-900/80 p-5 shadow-xl shadow-black/20 ring-1 ring-white/5">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Report Position</p>
          <div className="mt-4 grid gap-3">
            <PositionRow label="日付" value={currentReport.date} />
            <PositionRow label="表示元" value={jobResult ? "Supabase / 最新AI分析" : "mock-data"} />
            <PositionRow label="古いニュース非表示" value={`${staleNewsCount}件`} />
          </div>
        </div>
      </section>

      {jobResult?.error ? (
        <div className="rounded-2xl border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-200">
          Error: {jobResult.error}
        </div>
      ) : null}

      <section className="rounded-2xl border border-white/10 bg-slate-900/80 p-4 shadow-xl shadow-black/20 ring-1 ring-white/5 sm:p-5">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
          <div>
            <h3 className="text-lg font-black text-slate-50">銘柄別の位置</h3>
            <p className="mt-1 text-xs leading-5 text-slate-500">ニュースの偏りと重要度を銘柄ごとに確認します。</p>
          </div>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {tickerSummaries.map((item) => <TickerDigest key={item.ticker} item={item} />)}
          {!tickerSummaries.length ? (
            <p className="text-sm text-slate-400">銘柄別ニュースはまだありません。</p>
          ) : null}
        </div>
      </section>

      <div className="grid min-w-0 gap-4 md:grid-cols-2">
        {rows.map(([label, value, tone]) => (
          <section key={label} className={`min-w-0 rounded-2xl border p-4 shadow-xl shadow-black/20 ring-1 ring-white/5 sm:p-5 ${reportPanelClass(tone)}`}>
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-black text-slate-50">{label}</h3>
              <span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${reportPillClass(tone)}`}>{panelLabel(tone)}</span>
            </div>
            <ReportText value={value} tone={tone} />
          </section>
        ))}
      </div>

      <section className="min-w-0 rounded-2xl border border-white/10 bg-slate-900/80 p-4 shadow-xl shadow-black/20 ring-1 ring-white/5 sm:p-5">
        <h3 className="font-semibold text-slate-50">今日のニュースまとめ</h3>
        <p className="mt-1 text-xs text-slate-500">長いニュース要約は銘柄ごとに区切って表示します。</p>
        <ReportNewsSummary value={currentReport.news} />
      </section>

      <section className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold text-slate-50">ニュース別の読み解き</h3>
          <p className="mt-1 text-sm text-slate-400">{freshNewsWindowDays}日以内の海外ニュースだけを表示します。古いニュースは{staleNewsCount}件非表示です。</p>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          {reportNews.map((item, index) => <NewsCard key={newsKey(item, index)} item={item} />)}
        </div>
        {!reportNews.length ? (
          <div className="rounded-2xl border border-yellow-300/25 bg-yellow-300/10 p-5 text-sm leading-6 text-yellow-100">
            {freshNewsWindowDays}日以内のニュースがありません。Manual AI Jobで最新ニュースを取得してください。
          </div>
        ) : null}
      </section>
    </div>
  );
}

function ReportText({ value, tone }: { value: string; tone?: string }) {
  return (
    <div className="mt-2 space-y-2 text-sm leading-6 text-slate-300">
      {splitLines(value).map((line, index) => (
        <p key={`${line}-${index}`} className={`break-words rounded-xl px-3 py-2 [overflow-wrap:anywhere] ${index === 0 ? reportLineClass(tone) : "bg-slate-950/35"}`}>{line}</p>
      ))}
    </div>
  );
}

function SignalBox({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "green" | "red" | "blue" }) {
  const className = {
    default: "border-white/10 bg-slate-950/50 text-slate-100",
    green: "border-green-300/25 bg-green-300/10 text-green-100",
    red: "border-red-300/25 bg-red-300/10 text-red-100",
    blue: "border-sky-300/25 bg-sky-300/10 text-sky-100"
  }[tone];
  return (
    <div className={`rounded-2xl border p-3 ${className}`}>
      <p className="text-[10px] font-bold uppercase tracking-[0.12em] opacity-70">{label}</p>
      <p className="mt-1 text-2xl font-black">{value}</p>
    </div>
  );
}

function PositionRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-white/10 pb-3 text-sm last:border-b-0 last:pb-0">
      <span className="text-slate-500">{label}</span>
      <span className="font-black text-slate-100">{value}</span>
    </div>
  );
}

function TickerDigest({ item }: { item: TickerSummary }) {
  const tone = item.negative > item.positive ? "red" : item.positive > item.negative ? "green" : "blue";
  return (
    <article className={`rounded-2xl border p-4 ${tone === "red" ? "border-red-300/20 bg-red-300/10" : tone === "green" ? "border-green-300/20 bg-green-300/10" : "border-sky-300/20 bg-sky-300/10"}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-2xl font-black text-slate-50">{item.ticker}</p>
          <p className="mt-1 text-xs font-semibold text-slate-400">{item.count}件 / 平均影響 {item.averageImpact.toFixed(1)}</p>
        </div>
        <span className={`rounded-full px-2 py-1 text-[10px] font-black ${tone === "red" ? "bg-red-300/15 text-red-100" : tone === "green" ? "bg-green-300/15 text-green-100" : "bg-sky-300/15 text-sky-100"}`}>
          {tone === "red" ? "警戒" : tone === "green" ? "好材料優勢" : "中立"}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
        <MiniCount label="好" value={item.positive} tone="green" />
        <MiniCount label="悪" value={item.negative} tone="red" />
        <MiniCount label="重" value={item.highImpact} tone="yellow" />
      </div>
    </article>
  );
}

function MiniCount({ label, value, tone }: { label: string; value: number; tone: "green" | "red" | "yellow" }) {
  const className = {
    green: "text-green-200 bg-green-300/10",
    red: "text-red-200 bg-red-300/10",
    yellow: "text-yellow-200 bg-yellow-300/10"
  }[tone];
  return (
    <div className={`rounded-xl px-2 py-2 ${className}`}>
      <p className="font-bold">{label}</p>
      <p className="mt-0.5 text-base font-black">{value}</p>
    </div>
  );
}

function ReportNewsSummary({ value }: { value: string }) {
  const groups = value.split(/\n(?=【|[0-9]+\.\s)/).map((item) => item.trim()).filter(Boolean);

  if (groups.length === 0) return <p className="mt-3 text-sm text-slate-400">ニュースまとめはまだありません。</p>;

  return (
    <div className="mt-4 grid min-w-0 gap-3">
      {groups.map((group, index) => {
        const lines = splitLines(group);
        const title = lines[0] ?? `ニュース ${index + 1}`;
        const body = lines.slice(1);
        return (
          <article key={`${title}-${index}`} className="min-w-0 rounded-xl border border-white/10 bg-slate-950/50 p-3">
            <h4 className="break-words text-sm font-bold leading-6 text-sky-100 [overflow-wrap:anywhere]">{title}</h4>
            <div className="mt-2 space-y-1.5">
              {body.length ? body.map((line, lineIndex) => (
                <p key={`${line}-${lineIndex}`} className="break-words text-xs leading-5 text-slate-400 [overflow-wrap:anywhere]">{line}</p>
              )) : null}
            </div>
          </article>
        );
      })}
    </div>
  );
}

function splitLines(value: string) {
  return value.split("\n").map((line) => line.trim()).filter(Boolean);
}

function firstMeaningfulLine(value: string) {
  return splitLines(value)[0] ?? "AIレポートを確認中です。";
}

type TickerSummary = {
  ticker: string;
  count: number;
  positive: number;
  negative: number;
  highImpact: number;
  averageImpact: number;
};

function summarizeByTicker(items: typeof news): TickerSummary[] {
  const map = new Map<string, TickerSummary & { impactTotal: number }>();
  items.forEach((item) => {
    const current = map.get(item.ticker) ?? {
      ticker: item.ticker,
      count: 0,
      positive: 0,
      negative: 0,
      highImpact: 0,
      averageImpact: 0,
      impactTotal: 0
    };
    current.count += 1;
    current.impactTotal += item.impactScore;
    if (item.sentiment === "Positive") current.positive += 1;
    if (item.sentiment === "Negative") current.negative += 1;
    if (item.impactScore >= 8) current.highImpact += 1;
    current.averageImpact = current.impactTotal / current.count;
    map.set(item.ticker, current);
  });
  return Array.from(map.values())
    .sort((a, b) => b.highImpact - a.highImpact || b.averageImpact - a.averageImpact)
    .map((item) => ({
      ticker: item.ticker,
      count: item.count,
      positive: item.positive,
      negative: item.negative,
      highImpact: item.highImpact,
      averageImpact: item.averageImpact
    }));
}

function reportPanelClass(tone: string) {
  return {
    blue: "border-sky-300/20 bg-sky-300/[0.06]",
    green: "border-green-300/20 bg-green-300/[0.06]",
    gold: "border-yellow-300/20 bg-yellow-300/[0.06]",
    red: "border-red-300/20 bg-red-300/[0.06]"
  }[tone] ?? "border-white/10 bg-slate-900/80";
}

function reportPillClass(tone: string) {
  return {
    blue: "bg-sky-300/10 text-sky-100",
    green: "bg-green-300/10 text-green-100",
    gold: "bg-yellow-300/10 text-yellow-100",
    red: "bg-red-300/10 text-red-100"
  }[tone] ?? "bg-white/10 text-slate-200";
}

function reportLineClass(tone: string | undefined) {
  return {
    blue: "bg-sky-300/10 text-sky-50",
    green: "bg-green-300/10 text-green-50",
    gold: "bg-yellow-300/10 text-yellow-50",
    red: "bg-red-300/10 text-red-50"
  }[tone ?? ""] ?? "bg-slate-950/35";
}

function panelLabel(tone: string) {
  return {
    blue: "市場",
    green: "銘柄",
    gold: "結論",
    red: "明日"
  }[tone] ?? "分析";
}

function newsKey(item: { publishedAt: string; ticker: string; title: string; url?: string }, index: number) {
  return `${item.ticker}-${item.publishedAt}-${item.url ?? item.title}-${index}`;
}
