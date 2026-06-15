export function StatCard({ label, value, tone = "default" }: { label: string; value: string | number; tone?: "default" | "green" | "red" | "yellow" | "blue" | "gold" }) {
  const style = {
    default: "border-white/10 bg-neutral-950/78 text-slate-50",
    green: "border-emerald-400/25 bg-emerald-400/10 text-emerald-300",
    red: "border-rose-400/25 bg-rose-400/10 text-rose-300",
    yellow: "border-amber-300/25 bg-amber-300/10 text-amber-200",
    blue: "border-teal-300/25 bg-teal-300/10 text-teal-200",
    gold: "border-yellow-300/25 bg-yellow-300/10 text-yellow-200"
  }[tone];

  return (
    <div className={`rounded-xl border p-4 shadow-xl shadow-black/20 ring-1 ring-white/5 ${style}`}>
      <div className="flex items-center justify-between gap-3">
        <p className="truncate text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">{label}</p>
        <span className="h-1.5 w-8 rounded-full bg-current opacity-70" />
      </div>
      <p className="mt-3 truncate text-2xl font-black tracking-tight tabular-nums sm:text-3xl">{value}</p>
    </div>
  );
}
