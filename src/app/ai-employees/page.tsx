"use client";

import { AiEmployeeCard } from "@/components/AiEmployeeCard";
import { LiveWatchlistStrip } from "@/components/LiveWatchlistStrip";
import { HeaderPill, PageHeader } from "@/components/PageHeader";
import { aiTasks } from "@/lib/mock-data";
import { useAiJobResult } from "@/lib/use-ai-job-result";

export default function AiEmployeesPage() {
  const jobResult = useAiJobResult();
  const tasks = jobResult?.tasks ?? aiTasks;

  return (
    <div className="space-y-5">
      <LiveWatchlistStrip />
      <PageHeader
        eyebrow="Automation Team"
        title="AI Employees"
        description="実行状態とエラーだけを先に確認できます。"
        actions={(
          <>
            <HeaderPill label={`Last ${jobResult?.lastRun ?? "未実行"}`} tone={jobResult ? "green" : "yellow"} />
            <HeaderPill label={`Next ${jobResult?.nextRun ?? "毎日 07:00 JST"}`} />
          </>
        )}
      />

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
