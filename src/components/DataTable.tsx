import type { ReactNode } from "react";

export function DataTable({ headers, rows }: { headers: string[]; rows: ReactNode[][] }) {
  return (
    <div className="max-w-full overflow-x-auto rounded-2xl border border-white/10 bg-slate-900/82 shadow-xl shadow-black/25 ring-1 ring-white/5 [-webkit-overflow-scrolling:touch]">
      <table className="w-full min-w-[640px] text-left text-xs sm:text-sm">
        <thead className="bg-slate-950/80 text-[11px] uppercase tracking-[0.12em] text-slate-400 sm:text-xs sm:tracking-[0.16em]">
          <tr>
            {headers.map((header) => (
              <th key={header} className="px-3 py-3 font-bold sm:px-4">{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-t border-white/10 transition hover:bg-sky-300/[0.04]">
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="px-3 py-3 text-slate-200 first:font-semibold sm:px-4 sm:py-3.5">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
