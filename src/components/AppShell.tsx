import Link from "next/link";

const links = [
  ["/", "Dashboard"],
  ["/watchlist", "Watchlist"],
  ["/stocks/RGTI", "Stock Detail"],
  ["/news", "News"],
  ["/ai-employees", "AI Employees"],
  ["/reports", "Reports"],
  ["/settings", "Settings"]
];

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-50">
      <header className="border-b border-white/10 bg-slate-950/90">
        <div className="mx-auto max-w-[1600px] px-5 py-5">
          <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-end">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-sky-300">AI Portfolio Desk</p>
              <h1 className="mt-2 text-2xl font-bold text-slate-50">D Finance AI Stock Manager</h1>
            </div>
            <p className="text-sm text-slate-400">2026-05-30 / AI分析ステータス: Active</p>
          </div>
          <p className="mt-3 max-w-5xl text-xs text-slate-500">
            本アプリの分析は投資判断の補助を目的としたものであり、売買を推奨するものではありません。最終判断はご自身で行ってください。
          </p>
          <nav className="mt-5 flex gap-2 overflow-x-auto">
            {links.map(([href, label]) => (
              <Link key={href} href={href} className="whitespace-nowrap rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-300 hover:bg-white/10">
                {label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-[1600px] px-5 py-6">{children}</main>
    </div>
  );
}
