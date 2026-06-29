"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { MacroReleaseWatcher } from "@/components/MacroReleaseWatcher";
import { NewsNotificationCenter } from "@/components/NewsNotificationCenter";
import { PageTransition } from "@/components/PageTransition";
import { QuickAiJobButton } from "@/components/QuickAiJobButton";
import { authHeaders } from "@/lib/auth-fetch";
import { useNewsPreferencesSync } from "@/lib/news-preferences";
import type { PlanDefinition } from "@/lib/plans";
import { useAiJobResult } from "@/lib/use-ai-job-result";
import { useSupabaseAuth } from "@/lib/use-supabase-auth";
import { useUserWatchlist } from "@/lib/user-watchlist";
import type { NewsItem } from "@/types";

function buildNavLinks(detailTicker: string) {
  return [
    ["/", "Dashboard"],
    ["/watchlist", "Watchlist"],
    [`/stocks/${detailTicker}`, "Stock Detail"],
    ["/news", "News"],
    ["/ai-employees", "AI Employees"],
    ["/reports", "Reports"],
    ["/margin-simulator", "Margin Simulator"],
    ["/settings", "Settings"]
  ];
}

// モバイルボトムナビ（主要5ページ）
const bottomNavLinks = [
  { href: "/", label: "ホーム", icon: (
    <svg viewBox="0 0 20 20" fill="currentColor" className="size-5">
      <path d="M10.707 2.293a1 1 0 0 0-1.414 0l-7 7A1 1 0 0 0 3 11h1v6a1 1 0 0 0 1 1h4v-4h2v4h4a1 1 0 0 0 1-1v-6h1a1 1 0 0 0 .707-1.707l-7-7z" />
    </svg>
  )},
  { href: "/watchlist", label: "Watch", icon: (
    <svg viewBox="0 0 20 20" fill="currentColor" className="size-5">
      <path d="M5 3a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H5zm0 8a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2v-2a2 2 0 0 0-2-2H5zm6-6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2V5zm2 8a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2v-2a2 2 0 0 0-2-2h-2z" />
    </svg>
  )},
  { href: "/news", label: "News", icon: (
    <svg viewBox="0 0 20 20" fill="currentColor" className="size-5">
      <path fillRule="evenodd" d="M2 5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5zm3 1h6v4H5V6zm6 6H5v2h6v-2z" clipRule="evenodd" />
      <path d="M15 7h1a2 2 0 0 1 2 2v5.5a1.5 1.5 0 0 1-3 0V7z" />
    </svg>
  )},
  { href: "/ai-employees", label: "AI", icon: (
    <svg viewBox="0 0 20 20" fill="currentColor" className="size-5">
      <path fillRule="evenodd" d="M9.504 1.132a1 1 0 0 1 .992 0l1.75 1a1 1 0 1 1-.992 1.736L10 3.152l-1.254.716a1 1 0 1 1-.992-1.736l1.75-1zM5.618 4.504a1 1 0 0 1-.372 1.364L5.016 6l.23.132a1 1 0 1 1-.992 1.736L4 7.723V8a1 1 0 0 1-2 0V6a.996.996 0 0 1 .52-.878l1.734-.99a1 1 0 0 1 1.364.372zm8.764 0a1 1 0 0 1 1.364-.372l1.733.99A1.002 1.002 0 0 1 18 6v2a1 1 0 0 1-2 0v-.277l-.254.145a1 1 0 1 1-.992-1.736l.23-.132-.23-.132a1 1 0 0 1-.372-1.364zm-7 4a1 1 0 0 1 1.364-.372L10 8.848l1.254-.716a1 1 0 1 1 .992 1.736L11 10.58V12a1 1 0 0 1-2 0v-1.42l-1.246-.712a1 1 0 0 1-.372-1.364zM3 11a1 1 0 0 1 1 1v.277l.254-.145a1 1 0 0 1 .992 1.736l-.23.132.23.132a1 1 0 1 1-.992 1.736l-1.733-.99A1.002 1.002 0 0 1 2 14v-2a1 1 0 0 1 1-1zm14 0a1 1 0 0 1 1 1v2a1.002 1.002 0 0 1-.52.878l-1.734.99a1 1 0 1 1-.992-1.736l.23-.132-.23-.132a1 1 0 0 1 .992-1.736l.254.145V12a1 1 0 0 1 1-1zm-9.618 5.504a1 1 0 0 1 .372-1.364L9 14.848l1.246.712a1 1 0 1 1-.992 1.736l-1.75-1a1 1 0 0 1-.122-.792z" clipRule="evenodd" />
    </svg>
  )},
  { href: "/settings", label: "設定", icon: (
    <svg viewBox="0 0 20 20" fill="currentColor" className="size-5">
      <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 0 1-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 0 1 .947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 0 1 2.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 0 1 2.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 0 1 .947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 0 1-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 0 1-2.287-.947zM10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" clipRule="evenodd" />
    </svg>
  )},
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const auth = useSupabaseAuth();
  const jobResult = useAiJobResult();
  const userWatchlist = useUserWatchlist();
  const detailTicker = userWatchlist.items[0]?.stock.ticker ?? "RGTI";
  const links = buildNavLinks(detailTicker);
  const [today, setToday] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [aiDataAge, setAiDataAge] = useState("");
  const [aiDataSourceLabel, setAiDataSourceLabel] = useState("");
  const [planLabel, setPlanLabel] = useState("Free プラン");
  const [irNews, setIrNews] = useState<NewsItem[]>([]);
  const watchlistTickerKey = userWatchlist.items.map((item) => item.stock.ticker).filter(Boolean).join(",");
  const aiStatus = resolveAiStatus(jobResult?.status);
  useNewsPreferencesSync();

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

  // AI分析ジョブの鮮度を相対表示（例: "3分前", "2時間前", "3日前"）
  useEffect(() => {
    function computeAge() {
      const freshness = jobResult?.lastRun ?? jobResult?.dataFreshness;
      if (!freshness) {
        setAiDataAge("");
        setAiDataSourceLabel("");
        return;
      }
      setAiDataSourceLabel(freshness);
      const parsed = parseJobTimestamp(freshness);
      if (!Number.isFinite(parsed)) {
        setAiDataAge(freshness.slice(0, 10));
        return;
      }
      const diffMs = Date.now() - parsed;
      const diffMin = Math.floor(diffMs / 60_000);
      const diffHr = Math.floor(diffMin / 60);
      const diffDay = Math.floor(diffHr / 24);
      if (diffMin < 2) setAiDataAge("たった今");
      else if (diffMin < 60) setAiDataAge(`${diffMin}分前`);
      else if (diffHr < 24) setAiDataAge(`${diffHr}時間前`);
      else setAiDataAge(`${diffDay}日前`);
    }
    computeAge();
    const timer = window.setInterval(computeAge, 60_000);
    return () => window.clearInterval(timer);
  }, [jobResult?.dataFreshness, jobResult?.lastRun]);

  useEffect(() => {
    let cancelled = false;
    async function loadPlan() {
      try {
        const response = await fetch("/api/plan/summary", {
          cache: "no-store",
          headers: await authHeaders()
        });
        const payload = await response.json() as { ok: true; plan: PlanDefinition } | { ok: false };
        if (!cancelled && response.ok && payload.ok) {
          setPlanLabel(`${payload.plan.name} プラン`);
        }
      } catch {
        if (!cancelled) setPlanLabel("Free プラン");
      }
    }
    if (!auth.loading) void loadPlan();
    return () => {
      cancelled = true;
    };
  }, [auth.loading, auth.user?.id, auth.email]);

  useEffect(() => {
    let cancelled = false;
    async function loadIrNews() {
      const tickers = watchlistTickerKey.split(",").filter(Boolean);
      if (!tickers.length) {
        setIrNews([]);
        return;
      }
      try {
        const response = await fetch(`/api/news/ir/latest?tickers=${encodeURIComponent(tickers.join(","))}`, {
          cache: "no-store"
        });
        const payload = await response.json() as { ok: true; news: NewsItem[] } | { ok: false };
        if (!cancelled && response.ok && payload.ok) setIrNews(payload.news);
      } catch {
        if (!cancelled) setIrNews([]);
      }
    }
    void loadIrNews();
    const timer = window.setInterval(loadIrNews, 5 * 60 * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [watchlistTickerKey]);

  return (
    <div className="min-h-screen bg-[#050505] text-slate-50">
      <MacroReleaseWatcher />
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
                  {aiDataAge && (
                    <span
                      className={`rounded-full border px-2 py-0.5 font-semibold ${
                        resolveAgeTone(aiDataAge)
                      }`}
                      title={`AI分析ジョブ: ${aiDataSourceLabel}`}
                    >
                      AI分析 {aiDataAge}
                    </span>
                  )}
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
              <QuickAiJobButton />
              <NewsNotificationCenter jobResult={jobResult} extraNews={irNews} />
              <span className="rounded-full border border-teal-300/25 bg-teal-300/10 px-3 py-1.5 text-xs font-black text-teal-100">{planLabel}</span>
            </div>
          </div>
          <div className="mt-3 space-y-2 text-xs lg:hidden">
            <NewsNotificationCenter jobResult={jobResult} layout="mobile" extraNews={irNews} />
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-teal-300/25 bg-teal-300/10 px-3 py-1.5 font-black text-teal-100">{planLabel}</span>
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-slate-300">{today || "---- -- --"}</span>
              <span className={`rounded-full border px-3 py-1.5 font-semibold ${aiStatus.className}`}>{aiStatus.label}</span>
              {aiDataAge && (
                <span
                  className={`rounded-full border px-3 py-1.5 font-semibold ${resolveAgeTone(aiDataAge)}`}
                  title={`AI分析ジョブ: ${aiDataSourceLabel}`}
                >
                  AI分析 {aiDataAge}
                </span>
              )}
            </div>
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
      {/* モバイルコンテンツ：ボトムナビ分の余白 */}
      <main className="mx-auto max-w-[1600px] px-4 py-6 pb-24 sm:px-6 lg:py-8 lg:pb-8">
        <PageTransition>{children}</PageTransition>
      </main>

      <footer className="mx-auto max-w-[1600px] px-4 pb-28 sm:px-6 lg:pb-10">
        <div className="flex flex-col gap-3 border-t border-white/10 pt-6 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <p>本サービスは投資情報の補助ツールであり、投資助言サービスではありません。</p>
          <nav className="flex flex-wrap gap-4">
            <Link className="hover:text-slate-300" href="/legal/terms">利用規約</Link>
            <Link className="hover:text-slate-300" href="/legal/privacy">プライバシーポリシー</Link>
            <Link className="hover:text-slate-300" href="/legal/tokushoho">特定商取引法に基づく表記</Link>
          </nav>
        </div>
      </footer>

      {/* ─── モバイル ボトムナビゲーション ─────────────────────────────── */}
      <nav className="fixed bottom-0 left-0 right-0 z-30 border-t border-white/10 bg-black/90 backdrop-blur-xl lg:hidden safe-bottom">
        <div className="flex h-16 items-stretch">
          {bottomNavLinks.map(({ href, label, icon }) => {
            const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={`flex flex-1 flex-col items-center justify-center gap-1 text-[10px] font-bold transition-colors ${
                  active
                    ? "text-teal-300"
                    : "text-slate-500 hover:text-slate-300"
                }`}
              >
                <span className={`transition-transform ${active ? "scale-110" : ""}`}>
                  {icon}
                </span>
                <span>{label}</span>
                {active && (
                  <span className="absolute bottom-0 h-0.5 w-8 rounded-full bg-teal-300" />
                )}
              </Link>
            );
          })}
        </div>
      </nav>
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

function resolveAgeTone(age: string) {
  const dayMatch = age.match(/^(\d+)日前$/);
  if (dayMatch && Number(dayMatch[1]) >= 2) {
    return "border-red-400/30 bg-red-400/10 text-red-300";
  }
  if (age.includes("時間前") || dayMatch) {
    return "border-yellow-300/30 bg-yellow-300/10 text-yellow-200";
  }
  return "border-emerald-400/30 bg-emerald-400/10 text-emerald-300";
}

function parseJobTimestamp(value: string) {
  const normalized = value.trim();
  const jstDateTime = normalized.match(
    /^(\d{4})[/-](\d{2})[/-](\d{2})(?:\D+(\d{2}):(\d{2})(?::(\d{2}))?)?/
  );
  if (jstDateTime) {
    const [, year, month, day, hour = "00", minute = "00", second = "00"] = jstDateTime;
    return Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour) - 9,
      Number(minute),
      Number(second)
    );
  }
  return Date.parse(normalized);
}
