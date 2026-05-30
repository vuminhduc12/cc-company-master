export function StatCard({ label, value, tone = "default" }: { label: string; value: string | number; tone?: "default" | "green" | "red" | "yellow" | "blue" | "gold" }) {
  const style = {
    default: "border-white/10 bg-slate-900/78 text-slate-50",
    green: "border-green-400/25 bg-green-400/10 text-green-300",
    red: "border-red-400/25 bg-red-400/10 text-red-300",
    yellow: "border-yellow-300/25 bg-yellow-300/10 text-yellow-200",
    blue: "border-sky-300/25 bg-sky-300/10 text-sky-200",
    gold: "border-amber-300/25 bg-amber-300/10 text-amber-200"
  }[tone];

  return (
    <div className={`rounded-2xl border p-5 shadow-xl shadow-black/20 ring-1 ring-white/5 ${style}`}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{label}</p>
        <span className="mt-1 h-2 w-2 rounded-full bg-current opacity-75" />
      </div>
      <p className="mt-4 text-3xl font-black tracking-tight">{value}</p>
    </div>
  );
}
