import type { ReactNode } from "react";

export type DataQualityTone = "fresh" | "stale" | "fallback" | "warning" | "error";

export type DataQualityItem = {
  label: string;
  source: string;
  asOf?: string | null;
  tone?: DataQualityTone;
  detail?: string;
};

export function DataQualityPanel({
  title = "Data Quality",
  items,
  warnings = [],
  children
}: {
  title?: string;
  items: DataQualityItem[];
  warnings?: string[];
  children?: ReactNode;
}) {
  const visibleWarnings = warnings.filter(Boolean);
  const worstTone = resolveWorstTone(items, visibleWarnings);

  return (
    <section className={`rounded-2xl border p-4 shadow-xl shadow-black/20 ring-1 ring-white/5 ${panelClass(worstTone)}`}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-300">{title}</p>
            <span className={`rounded-full border px-2.5 py-1 text-[10px] font-black ${tonePillClass(worstTone)}`}>{toneLabel(worstTone)}</span>
          </div>
          <p className="mt-2 text-xs leading-5 text-slate-400">
            表示データは参考情報です。売買判断ではなく、取得元・更新時刻・欠損/補正状態を確認してから利用してください。
          </p>
        </div>
        {children ? <div className="shrink-0">{children}</div> : null}
      </div>

      <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        {items.map((item) => <QualityTile key={item.label} item={item} />)}
      </div>

      {visibleWarnings.length ? (
        <div className="mt-3 rounded-xl border border-amber-300/20 bg-amber-300/[0.08] p-3">
          <p className="text-[11px] font-black uppercase tracking-[0.16em] text-amber-200">確認が必要</p>
          <ul className="mt-2 space-y-1 text-xs leading-5 text-amber-50/90">
            {visibleWarnings.slice(0, 4).map((warning, index) => (
              <li key={`${warning}-${index}`}>・{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

export function freshnessTone(asOf?: string | null, freshMinutes = 20, staleMinutes = 24 * 60): DataQualityTone {
  if (!asOf) return "fallback";
  const time = Date.parse(asOf);
  if (!Number.isFinite(time)) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return "stale";
    return "warning";
  }
  const ageMinutes = (Date.now() - time) / 60000;
  if (ageMinutes < -10) return "warning";
  if (ageMinutes <= freshMinutes) return "fresh";
  if (ageMinutes <= staleMinutes) return "stale";
  return "fallback";
}

function QualityTile({ item }: { item: DataQualityItem }) {
  const tone = item.tone ?? freshnessTone(item.asOf);
  return (
    <div className={`min-w-0 rounded-xl border p-3 ${tileClass(tone)}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-400">{item.label}</p>
        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-black ${tonePillClass(tone)}`}>{toneLabel(tone)}</span>
      </div>
      <p className="mt-2 truncate text-sm font-black text-slate-100">{item.source}</p>
      <p className="mt-1 text-xs leading-5 text-slate-500">{item.asOf ? formatQualityTime(item.asOf) : "更新時刻なし"}</p>
      {item.detail ? <p className="mt-2 text-xs leading-5 text-slate-400">{item.detail}</p> : null}
    </div>
  );
}

function resolveWorstTone(items: DataQualityItem[], warnings: string[]): DataQualityTone {
  if (items.some((item) => item.tone === "error")) return "error";
  if (warnings.length || items.some((item) => item.tone === "warning")) return "warning";
  if (items.some((item) => (item.tone ?? freshnessTone(item.asOf)) === "fallback")) return "fallback";
  if (items.some((item) => (item.tone ?? freshnessTone(item.asOf)) === "stale")) return "stale";
  return "fresh";
}

function panelClass(tone: DataQualityTone) {
  if (tone === "error") return "border-red-400/30 bg-red-400/10";
  if (tone === "warning" || tone === "fallback") return "border-amber-300/25 bg-amber-300/[0.06]";
  if (tone === "stale") return "border-sky-300/20 bg-sky-300/[0.06]";
  return "border-emerald-300/20 bg-emerald-300/[0.055]";
}

function tileClass(tone: DataQualityTone) {
  if (tone === "error") return "border-red-300/25 bg-red-300/[0.08]";
  if (tone === "warning" || tone === "fallback") return "border-amber-300/20 bg-black/25";
  if (tone === "stale") return "border-sky-300/18 bg-black/25";
  return "border-emerald-300/18 bg-black/25";
}

function tonePillClass(tone: DataQualityTone) {
  if (tone === "error") return "border-red-300/30 bg-red-300/10 text-red-100";
  if (tone === "warning") return "border-amber-300/30 bg-amber-300/10 text-amber-100";
  if (tone === "fallback") return "border-yellow-300/30 bg-yellow-300/10 text-yellow-100";
  if (tone === "stale") return "border-sky-300/30 bg-sky-300/10 text-sky-100";
  return "border-emerald-300/30 bg-emerald-300/10 text-emerald-100";
}

function toneLabel(tone: DataQualityTone) {
  if (tone === "error") return "Error";
  if (tone === "warning") return "Check";
  if (tone === "fallback") return "Fallback";
  if (tone === "stale") return "Stale";
  return "Fresh";
}

function formatQualityTime(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}
