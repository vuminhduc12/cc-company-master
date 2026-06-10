"use client";

import { AiEmployeeCard } from "@/components/AiEmployeeCard";
import { LiveWatchlistStrip } from "@/components/LiveWatchlistStrip";
import { aiTasks } from "@/lib/mock-data";
import { useAiJobResult } from "@/lib/use-ai-job-result";

export default function AiEmployeesPage() {
  const jobResult = useAiJobResult();
  const tasks = jobResult?.tasks ?? aiTasks;

  return (
    <div className="space-y-5">
      <LiveWatchlistStrip />
      <div className="rounded-3xl border border-white/10 bg-slate-900/80 p-6 shadow-xl shadow-black/25 ring-1 ring-white/5">
        <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-end">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-300">Automation Team</p>
            <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-50">AI Employees</h2>
            <p className="mt-2 text-sm text-slate-400">最終実行時間、ステータス、結果、エラー、次回予定を確認できます。</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-slate-950/55 px-4 py-3 text-sm text-slate-300">
            <span className="text-slate-500">Last AI Run:</span> {jobResult?.lastRun ?? "未実行"}
            <span className="ml-4 text-slate-500">Next:</span> {jobResult?.nextRun ?? "毎日 07:00 JST"}
          </div>
        </div>
      </div>

      {jobResult?.error ? (
        <div className="rounded-2xl border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-200">
          Error: {jobResult.error}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {tasks.map((task) => <AiEmployeeCard key={task.name} task={task} />)}
      </div>
    </div>
  );
}
