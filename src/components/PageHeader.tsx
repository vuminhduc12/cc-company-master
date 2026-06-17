import type { ReactNode } from "react";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  metrics
}: {
  eyebrow: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  metrics?: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-white/10 bg-slate-900/72 p-4 shadow-xl shadow-black/20 ring-1 ring-white/5 sm:p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-black uppercase tracking-[0.20em] text-sky-300">{eyebrow}</p>
          <h1 className="mt-1 truncate text-2xl font-black tracking-tight text-slate-50 sm:text-3xl">{title}</h1>
          {description ? <p className="mt-2 max-w-3xl text-xs leading-5 text-slate-500 sm:text-sm">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {metrics ? <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{metrics}</div> : null}
    </section>
  );
}

export function HeaderPill({ label, tone = "default" }: { label: string; tone?: "default" | "green" | "yellow" | "red" | "blue" }) {
  const className = {
    default: "border-white/10 bg-white/[0.055] text-slate-300",
    green: "border-emerald-300/25 bg-emerald-300/10 text-emerald-100",
    yellow: "border-amber-300/25 bg-amber-300/10 text-amber-100",
    red: "border-red-300/25 bg-red-300/10 text-red-100",
    blue: "border-sky-300/25 bg-sky-300/10 text-sky-100"
  }[tone];

  return (
    <span className={`rounded-full border px-3 py-1.5 text-xs font-black ${className}`}>
      {label}
    </span>
  );
}
