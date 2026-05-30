import type { AiTask } from "@/types";
import { StatusBadge } from "./StatusBadge";

export function AiEmployeeCard({ task }: { task: AiTask }) {
  return (
    <article className="rounded-2xl border border-white/10 bg-slate-900/82 p-4 shadow-xl shadow-black/20 ring-1 ring-white/5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-slate-50">{task.name}</h3>
          <p className="mt-1 text-xs font-semibold uppercase tracking-[0.16em] text-sky-200">{task.role}</p>
        </div>
        <StatusBadge value={task.status} />
      </div>
      <p className="mt-3 min-h-10 text-sm leading-6 text-slate-300">{task.task}</p>
      <div className="mt-4 rounded-xl border border-white/10 bg-slate-950/55 p-3">
        <p className="text-xs text-slate-500">Result</p>
        <p className="mt-1 text-sm leading-6 text-slate-100">{task.result}</p>
        {task.error ? <p className="mt-2 text-sm text-red-300">{task.error}</p> : null}
        <p className="mt-2 text-xs text-slate-500">{task.lastRun}</p>
        {task.nextRun ? <p className="mt-1 text-xs text-slate-500">Next: {task.nextRun}</p> : null}
      </div>
    </article>
  );
}
