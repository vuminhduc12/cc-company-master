"use client";

import { NewsCard } from "@/components/NewsCard";
import { news, report } from "@/lib/mock-data";
import { useAiJobResult } from "@/lib/use-ai-job-result";

export default function ReportsPage() {
  const jobResult = useAiJobResult();
  const currentReport = jobResult?.report ?? report;
  const reportNews = jobResult?.news ?? news;
  const rows = [
    ["市場全体の雰囲気", currentReport.market],
    ["監視銘柄の状態", currentReport.watchlist],
    ["AI総合判断", currentReport.decision],
    ["明日の戦略", currentReport.tomorrow]
  ];

  return (
    <div className="space-y-5">
      <div className="rounded-3xl border border-white/10 bg-slate-900/80 p-6 shadow-xl shadow-black/25 ring-1 ring-white/5">
        <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-end">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-300">Daily Briefing</p>
            <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-50">AI日次レポート</h2>
            <p className="mt-2 text-sm text-slate-400">
              {jobResult ? `最終AI分析: ${jobResult.lastRun}` : "mock-dataを表示中"}。今日の結論、明日の確認点、ニュース別の読み解きをまとめます。
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-slate-950/55 px-4 py-3 text-sm text-slate-300">
            表示元: {jobResult ? "Supabase / 最新AI分析" : "mock-data"}
          </div>
        </div>
      </div>
      {jobResult?.error ? (
        <div className="rounded-2xl border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-200">
          Error: {jobResult.error}
        </div>
      ) : null}
      <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-5 shadow-xl shadow-black/20 ring-1 ring-white/5">
        <p className="text-sm text-slate-400">日付</p>
        <p className="text-lg font-semibold text-slate-50">{currentReport.date}</p>
      </div>
      <div className="grid min-w-0 gap-4 md:grid-cols-2">
        {rows.map(([label, value]) => (
          <section key={label} className="min-w-0 rounded-2xl border border-white/10 bg-slate-900/80 p-4 shadow-xl shadow-black/20 ring-1 ring-white/5 sm:p-5">
            <h3 className="font-semibold text-slate-50">{label}</h3>
            <ReportText value={value} />
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
          <p className="mt-1 text-sm text-slate-400">海外ニュースをAIが日本語で整理した内容です。</p>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          {reportNews.map((item, index) => <NewsCard key={newsKey(item, index)} item={item} />)}
        </div>
      </section>
    </div>
  );
}

function ReportText({ value }: { value: string }) {
  return (
    <div className="mt-2 space-y-2 text-sm leading-6 text-slate-300">
      {splitLines(value).map((line, index) => (
        <p key={`${line}-${index}`} className="break-words [overflow-wrap:anywhere]">{line}</p>
      ))}
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

function newsKey(item: { publishedAt: string; ticker: string; title: string; url?: string }, index: number) {
  return `${item.ticker}-${item.publishedAt}-${item.url ?? item.title}-${index}`;
}
