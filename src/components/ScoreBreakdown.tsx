import { StatusBadge } from "@/components/StatusBadge";
import type { ScoreFactor, WatchStatus } from "@/types";

export function ScoreBreakdown({
  factors,
  score,
  status
}: {
  factors: ScoreFactor[];
  score: number;
  status: WatchStatus;
}) {
  const maxAbs = Math.max(1, ...factors.map((factor) => Math.abs(factor.points)));
  const bullPoints = factors.filter((f) => f.points > 0).reduce((s, f) => s + f.points, 0);
  const bearPoints = Math.abs(factors.filter((f) => f.points < 0).reduce((s, f) => s + f.points, 0));
  const total = bullPoints + bearPoints || 1;
  const bullPct = Math.round((bullPoints / total) * 100);
  const bearPct = 100 - bullPct;

  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/45 p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-bold text-slate-50">スコア内訳（{score}点）</h3>
        <StatusBadge value={status} />
      </div>

      {/* Bull / Bear ゲージ */}
      <div className="mt-3">
        <div className="mb-1 flex items-center justify-between text-[11px] font-bold">
          <span className="text-emerald-400">▲ Bull {bullPct}%</span>
          <span className="text-red-400">Bear {bearPct}% ▼</span>
        </div>
        <div className="flex h-2 overflow-hidden rounded-full bg-slate-800">
          <div
            className="h-full rounded-l-full bg-gradient-to-r from-emerald-600 to-emerald-400 transition-all duration-700"
            style={{ width: `${bullPct}%` }}
          />
          <div
            className="h-full rounded-r-full bg-gradient-to-r from-red-500 to-red-400 transition-all duration-700"
            style={{ width: `${bearPct}%` }}
          />
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {factors.map((factor) => (
          <ScoreBreakdownRow key={factor.label} factor={factor} maxAbs={maxAbs} />
        ))}
      </div>
    </div>
  );
}

function ScoreBreakdownRow({ factor, maxAbs }: { factor: ScoreFactor; maxAbs: number }) {
  const isPositive = factor.points > 0;
  const isNegative = factor.points < 0;
  const width = `${Math.round((Math.abs(factor.points) / maxAbs) * 100)}%`;
  const fillColor = isNegative ? "bg-red-400" : isPositive ? "bg-green-400" : "bg-slate-500";
  const valueColor = isNegative ? "text-red-300" : isPositive ? "text-green-300" : "text-slate-400";

  return (
    <div className="flex items-center gap-3 text-xs sm:text-sm" title={factor.detail}>
      <span className="w-20 shrink-0 truncate font-semibold text-slate-300">{factor.label}</span>
      <span className="h-1 flex-1 overflow-hidden rounded-sm bg-slate-700/70">
        <span className={`block h-full rounded-sm ${fillColor}`} style={{ width }} />
      </span>
      <span className={`w-10 shrink-0 text-right font-bold tabular-nums ${valueColor}`}>
        {factor.points > 0 ? "+" : ""}{factor.points}
      </span>
    </div>
  );
}
