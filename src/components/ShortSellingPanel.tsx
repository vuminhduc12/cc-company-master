"use client";

import { DataTable } from "@/components/DataTable";
import type { ShortSellingFetchResult } from "@/lib/short-selling-data";
import type { ShortSellingDisclosure } from "@/types";

export function ShortSellingPanel({
  status,
  error,
  data
}: {
  status: "idle" | "loading" | "done" | "error";
  error: string;
  data: ShortSellingFetchResult | null;
}) {
  if (status === "loading") {
    return (
      <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-5 text-sm text-slate-400">
        空売り残高報告を取得中…
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="rounded-2xl border border-red-400/30 bg-red-400/10 p-5 text-sm leading-6 text-red-200">
        {error}
      </div>
    );
  }

  if (!data) return null;

  if (!data.configured) {
    return (
      <div className="rounded-2xl border border-yellow-300/25 bg-yellow-300/10 p-5 text-sm leading-7 text-yellow-100">
        <p className="font-bold">J-Quants API が未設定です</p>
        <p className="mt-2">
          空売り残高報告（残高割合0.5%以上）を取得するには、`.env.local` と Vercel に `JQUANTS_API_KEY` を設定してください。
          J-Quants のスタンダードプラン以上で利用できます。
        </p>
        <a
          className="mt-3 inline-flex text-xs font-bold text-sky-200 underline"
          href="https://jpx-jquants.com/"
          rel="noreferrer"
          target="_blank"
        >
          J-Quants API 公式サイト ↗
        </a>
      </div>
    );
  }

  const latestRows = groupLatestDisclosures(data.disclosures);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        <MetricCard label="最新公表日" value={data.latestDisclosedDate ?? "-"} />
        <MetricCard label="報告件数" value={`${data.disclosures.length}件`} />
        <MetricCard label="データ源" value={data.sourceLabel} />
      </div>

      {data.warning ? (
        <div className="rounded-2xl border border-yellow-300/25 bg-yellow-300/10 px-4 py-3 text-xs leading-6 text-yellow-100">
          {data.warning}
        </div>
      ) : null}

      {latestRows.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-5 text-sm leading-6 text-slate-400">
          この銘柄について、残高割合0.5%以上の空売り残高報告は見つかりませんでした。
        </div>
      ) : (
        <>
          <div className="hidden md:block">
            <DataTable
              headers={["公表日", "計算日", "報告者", "残高割合", "残高株数", "前回比", "備考"]}
              rows={latestRows.slice(0, 30).map((row) => [
                row.disclosedDate,
                row.calculatedDate,
                row.reporterName,
                `${row.ratioPercent.toFixed(2)}%`,
                row.shares.toLocaleString("ja-JP"),
                row.previousRatioPercent > 0 ? `${row.previousRatioPercent.toFixed(2)}%` : "-",
                row.notes || "-"
              ])}
            />
          </div>
          <div className="space-y-3 md:hidden">
            {latestRows.slice(0, 12).map((row) => (
              <article key={`${row.disclosedDate}-${row.reporterName}-${row.ratioPercent}`} className="rounded-2xl border border-white/10 bg-slate-900/80 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-black text-slate-50">{row.reporterName}</p>
                    <p className="mt-1 text-xs text-slate-500">{row.disclosedDate} / 計算 {row.calculatedDate}</p>
                  </div>
                  <p className="text-lg font-black text-red-300">{row.ratioPercent.toFixed(2)}%</p>
                </div>
                <p className="mt-3 text-xs text-slate-400">残高 {row.shares.toLocaleString("ja-JP")} 株</p>
              </article>
            ))}
          </div>
        </>
      )}

      <p className="text-xs leading-5 text-slate-500">
        出典: JPX公表と同等の空売り残高報告（残高割合0.5%以上）。参考情報であり、投資判断はご自身で行ってください。
      </p>
    </div>
  );
}

function groupLatestDisclosures(rows: ShortSellingDisclosure[]) {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = `${row.disclosedDate}|${row.reporterName}|${row.ratioPercent}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-4">
      <p className="text-xs font-semibold text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-black text-slate-50">{value}</p>
    </div>
  );
}
