export function StatCard({ label, value, tone = "default" }: { label: string; value: string | number; tone?: "default" | "green" | "red" | "yellow" | "blue" | "gold" }) {
  const valueColor = {
    default: "text-slate-50",
    green: "text-green-400",
    red: "text-red-400",
    yellow: "text-yellow-300",
    blue: "text-sky-300",
    gold: "text-amber-400"
  }[tone];

  return (
    <div className="rounded-2xl border border-white/10 bg-slate-900/75 p-5 shadow-lg shadow-black/20">
      <p className="text-sm text-slate-400">{label}</p>
      <p className={`mt-3 text-3xl font-bold tracking-tight ${valueColor}`}>{value}</p>
    </div>
  );
}
