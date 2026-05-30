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
    <div className="min-h-screen bg-[#020617] text-slate-50">
      <div className="fixed inset-0 -z-10 bg-[linear-gradient(180deg,rgba(14,165,233,0.10),rgba(2,6,23,0)_260px),linear-gradient(90deg,rgba(15,23,42,0.65)_1px,transparent_1px),linear-gradient(180deg,rgba(15,23,42,0.65)_1px,transparent_1px)] bg-[size:100%_100%,48px_48px,48px_48px]" />
      <header className="sticky top-0 z-20 border-b border-white/10 bg-slate-950/85 backdrop-blur-xl">
        <div className="mx-auto max-w-[1600px] px-4 py-4 sm:px-6">
          <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-sky-300 sm:text-xs sm:tracking-[0.32em]">AI Portfolio Desk</p>
              <h1 className="mt-2 text-2xl font-black leading-tight tracking-tight text-slate-50 sm:text-3xl">D Finance AI Stock Manager</h1>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-slate-300">2026-05-30</span>
              <span className="rounded-full border border-green-400/30 bg-green-400/10 px-3 py-1.5 font-semibold text-green-300">AI Active</span>
            </div>
          </div>
          <p className="mt-3 max-w-5xl text-xs leading-5 text-slate-500">
            本アプリの分析は投資判断の補助を目的としたものであり、売買を推奨するものではありません。最終判断はご自身で行ってください。
          </p>
          <nav className="mt-4 flex gap-2 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch]">
            {links.map(([href, label]) => (
              <Link key={href} href={href} className="whitespace-nowrap rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-slate-300 transition hover:border-sky-300/30 hover:bg-sky-300/10 hover:text-sky-100 sm:px-4 sm:text-sm">
                {label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:py-8">{children}</main>
    </div>
  );
}
