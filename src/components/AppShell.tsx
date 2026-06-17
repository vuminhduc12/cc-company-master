"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { NewsNotificationCenter } from "@/components/NewsNotificationCenter";
import { useAiJobResult } from "@/lib/use-ai-job-result";

const links = [
  ["/", "Dashboard"],
  ["/watchlist", "Watchlist"],
  ["/stocks/RGTI", "Stock Detail"],
  ["/news", "News"],
  ["/ai-employees", "AI Employees"],
  ["/reports", "Reports"],
  ["/margin-simulator", "Margin Simulator"],
  ["/settings", "Settings"]
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const jobResult = useAiJobResult();
  const [today, setToday] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const aiStatus = resolveAiStatus(jobResult?.status);

  useEffect(() => {
    function updateToday() {
      setToday(new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Tokyo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }).format(new Date()));
    }
    updateToday();
    const timer = window.setInterval(updateToday, 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="min-h-screen bg-[#050505] text-slate-50">
      <div className="fixed inset-0 -z-10 bg-[linear-gradient(180deg,rgba(20,184,166,0.12),rgba(5,5,5,0)_300px),linear-gradient(120deg,rgba(245,158,11,0.08),transparent_32%),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(180deg,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:100%_100%,100%_100%,44px_44px,44px_44px]" />
      <header className="sticky top-0 z-20 border-b border-white/10 bg-black/[0.78] backdrop-blur-xl">
        <div className="mx-auto max-w-[1600px] px-4 py-3 sm:px-6">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <Link className="grid size-10 shrink-0 place-items-center rounded-xl border border-teal-300/30 bg-teal-300/10 text-sm font-black text-teal-100 shadow-lg shadow-teal-950/30" href="/">
                Q
              </Link>
              <div className="min-w-0">
                <Link className="block truncate text-sm font-black tracking-tight text-slate-50 sm:text-base" href="/">
                  株価 AIスクリーナー
                </Link>
                <div className="mt-1 hidden items-center gap-2 text-xs text-slate-500 sm:flex">
                  <span>{today || "---- -- --"}</span>
                  <span className={`rounded-full border px-2 py-0.5 font-semibold ${aiStatus.className}`}>{aiStatus.label}</span>
                </div>
              </div>
            </div>
            <button
              aria-expanded={menuOpen}
              aria-label={menuOpen ? "メニューを閉じる" : "メニューを開く"}
              className="grid size-10 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[0.06] text-slate-100 shadow-lg shadow-black/20 transition hover:border-teal-300/30 hover:bg-teal-300/10 lg:hidden"
              onClick={() => setMenuOpen((current) => !current)}
              type="button"
            >
              <span className="relative block h-4 w-5">
                <span className={`absolute left-0 top-0 h-0.5 w-5 rounded-full bg-current transition ${menuOpen ? "translate-y-[7px] rotate-45" : ""}`} />
                <span className={`absolute left-0 top-[7px] h-0.5 w-5 rounded-full bg-current transition ${menuOpen ? "opacity-0" : ""}`} />
                <span className={`absolute left-0 top-[14px] h-0.5 w-5 rounded-full bg-current transition ${menuOpen ? "-translate-y-[7px] -rotate-45" : ""}`} />
              </span>
            </button>
            <div className="hidden items-center gap-2 lg:flex">
              <NewsNotificationCenter jobResult={jobResult} />
              <span className="rounded-full border border-teal-300/25 bg-teal-300/10 px-3 py-1.5 text-xs font-black text-teal-100">Free プラン</span>
            </div>
          </div>
          <p className="mt-2 border-l-2 border-teal-300/35 pl-3 text-[11px] leading-5 text-slate-500">
            参考情報です。最終判断はご自身でご確認ください
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs lg:hidden">
            <NewsNotificationCenter jobResult={jobResult} />
            <span className="rounded-full border border-teal-300/25 bg-teal-300/10 px-3 py-1.5 font-black text-teal-100">Free プラン</span>
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-slate-300">{today || "---- -- --"}</span>
            <span className={`rounded-full border px-3 py-1.5 font-semibold ${aiStatus.className}`}>{aiStatus.label}</span>
          </div>
          <nav className="mt-3 hidden gap-1.5 overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.035] p-1 [-webkit-overflow-scrolling:touch] lg:flex">
            {links.map(([href, label]) => {
              const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={active
                    ? "whitespace-nowrap rounded-xl border border-teal-300/35 bg-teal-300/[0.14] px-3.5 py-2 text-sm font-black text-teal-50 shadow-lg shadow-teal-950/20"
                    : "whitespace-nowrap rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2 text-sm font-semibold text-slate-300 transition hover:border-teal-300/30 hover:bg-teal-300/10 hover:text-teal-100"}
                >
                  {label}
                </Link>
              );
            })}
          </nav>
          {menuOpen ? (
            <nav className="mt-4 rounded-2xl border border-white/10 bg-neutral-950/95 p-2 shadow-2xl shadow-black/40 ring-1 ring-white/5 lg:hidden">
              <div className="grid gap-2">
                {links.map(([href, label]) => {
                  const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
                  return (
                    <Link
                      key={href}
                      className={active
                        ? "flex items-center justify-between rounded-xl border border-teal-300/35 bg-teal-300/[0.14] px-4 py-3 text-sm font-black text-teal-50"
                        : "flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-bold text-slate-100 transition hover:border-teal-300/30 hover:bg-teal-300/10"}
                      href={href}
                      onClick={() => setMenuOpen(false)}
                    >
                      <span>{label}</span>
                      <span className="text-slate-500">›</span>
                    </Link>
                  );
                })}
              </div>
            </nav>
          ) : null}
        </div>
      </header>
      <main className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:py-8">{children}</main>
    </div>
  );
}

function resolveAiStatus(status: string | undefined) {
  if (status === "Completed") {
    return {
      label: "AI Active",
      className: "border-green-400/30 bg-green-400/10 text-green-300"
    };
  }
  if (status === "Running") {
    return {
      label: "AI Running",
      className: "border-sky-300/30 bg-sky-300/10 text-sky-200"
    };
  }
  if (status === "Error") {
    return {
      label: "AI Error",
      className: "border-red-400/30 bg-red-400/10 text-red-300"
    };
  }
  return {
    label: "AI Pending",
    className: "border-yellow-300/30 bg-yellow-300/10 text-yellow-200"
  };
}
