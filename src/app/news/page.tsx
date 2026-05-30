"use client";

import { NewsCard } from "@/components/NewsCard";
import { news } from "@/lib/mock-data";
import { useAiJobResult } from "@/lib/use-ai-job-result";

export default function NewsPage() {
  const jobResult = useAiJobResult();
  const items = jobResult?.news ?? news;
  const featured = items[0];
  const positiveCount = items.filter((item) => item.sentiment === "Positive").length;
  const negativeCount = items.filter((item) => item.sentiment === "Negative").length;
  const averageImpact = items.length > 0 ? items.reduce((sum, item) => sum + item.impactScore, 0) / items.length : 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-end">
        <div>
          <h2 className="text-2xl font-bold text-slate-50">AIニュース分析</h2>
          <p className="mt-1 text-sm text-slate-400">
            {jobResult ? `海外ニュースを日本語で分析 / 最終AI分析: ${jobResult.lastRun}` : "mock-dataを表示中"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a className="rounded-full border border-white/10 bg-slate-900/75 px-4 py-2 text-sm font-semibold text-sky-200 hover:bg-slate-800" href="https://www.google.com/finance/quote/RGTI:NASDAQ" target="_blank" rel="noreferrer">
            Google Financeで確認 ↗
          </a>
          <div className="rounded-full border border-white/10 bg-slate-900/75 px-4 py-2 text-sm text-slate-300">
            {jobResult ? "Supabase / 最新AI分析" : "mock-data"}
          </div>
        </div>
      </div>
      {jobResult?.error ? (
        <div className="rounded-2xl border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-200">
          Error: {jobResult.error}
        </div>
      ) : null}

      <section className="grid gap-3 md:grid-cols-4">
        <Metric label="取得ニュース" value={`${items.length}件`} />
        <Metric label="Positive" value={`${positiveCount}件`} tone="green" />
        <Metric label="Negative" value={`${negativeCount}件`} tone="red" />
        <Metric label="平均影響度" value={`${averageImpact.toFixed(1)}/10`} tone="blue" />
      </section>

      {featured ? <NewsCard item={featured} featured /> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {items.slice(1).map((item) => <NewsCard key={`${item.publishedAt}-${item.title}`} item={item} />)}
      </div>
    </div>
  );
}

function Metric({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "green" | "red" | "blue" }) {
  const color = {
    default: "text-slate-50",
    green: "text-green-300",
    red: "text-red-300",
    blue: "text-sky-300"
  }[tone];

  return (
    <div className="rounded-2xl border border-white/10 bg-slate-900/75 p-4">
      <p className="text-xs text-slate-400">{label}</p>
      <p className={`mt-1 text-xl font-bold ${color}`}>{value}</p>
    </div>
  );
}
