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
    ["今日のニュースまとめ", currentReport.news],
    ["AI総合判断", currentReport.decision],
    ["明日の戦略", currentReport.tomorrow]
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-end">
        <div>
          <h2 className="text-2xl font-bold text-slate-50">AI日次レポート</h2>
          <p className="mt-1 text-sm text-slate-400">
            {jobResult ? `最終AI分析: ${jobResult.lastRun}` : "mock-dataを表示中"}
          </p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-slate-900/75 px-4 py-3 text-sm text-slate-300">
          表示元: {jobResult ? "Supabase / 最新AI分析" : "mock-data"}
        </div>
      </div>
      {jobResult?.error ? (
        <div className="rounded-2xl border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-200">
          Error: {jobResult.error}
        </div>
      ) : null}
      <div className="rounded-2xl border border-white/10 bg-slate-900/75 p-5">
        <p className="text-sm text-slate-400">日付</p>
        <p className="text-lg font-semibold text-slate-50">{currentReport.date}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {rows.map(([label, value]) => (
          <section key={label} className="rounded-2xl border border-white/10 bg-slate-900/75 p-5">
            <h3 className="font-semibold text-slate-50">{label}</h3>
            <p className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-300">{value}</p>
          </section>
        ))}
      </div>
      <section className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold text-slate-50">ニュース別の読み解き</h3>
          <p className="mt-1 text-sm text-slate-400">海外ニュースをAIが日本語で整理した内容です。</p>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          {reportNews.map((item) => <NewsCard key={`${item.publishedAt}-${item.title}`} item={item} />)}
        </div>
      </section>
    </div>
  );
}
