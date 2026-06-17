"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { newsIdentity } from "@/lib/use-ai-job-result";
import type { AiJobResult, NewsItem } from "@/types";

const seenNewsStorageKey = "d-finance-seen-news-notifications";

export function NewsNotificationCenter({ jobResult }: { jobResult: AiJobResult | null }) {
  const [open, setOpen] = useState(false);
  const [seenKeys, setSeenKeys] = useState<Set<string>>(() => readSeenNewsKeys());
  const latestNews = useMemo(() => normalizeLatestNews(jobResult?.news ?? []), [jobResult?.news]);
  const unreadItems = latestNews.filter((item) => !seenKeys.has(newsIdentity(item)));
  const featured = latestNews[0] ?? null;
  const sourceLabel = jobResult
    ? jobResult.mode === "live"
      ? "AI News"
      : "Local News"
    : "AI Pending";

  useEffect(() => {
    setSeenKeys(readSeenNewsKeys());
  }, [jobResult?.lastRun]);

  function toggleOpen() {
    const nextOpen = !open;
    setOpen(nextOpen);
    if (nextOpen && latestNews.length) {
      const nextKeys = new Set(seenKeys);
      latestNews.slice(0, 6).forEach((item) => nextKeys.add(newsIdentity(item)));
      writeSeenNewsKeys(nextKeys);
      setSeenKeys(nextKeys);
    }
  }

  return (
    <div className="relative">
      <button
        aria-expanded={open}
        className="group flex min-w-[168px] items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.055] px-3 py-2 text-left shadow-lg shadow-black/20 transition hover:border-amber-300/30 hover:bg-amber-300/10"
        onClick={toggleOpen}
        type="button"
      >
        <span className="min-w-0">
          <span className="block text-[10px] font-black uppercase tracking-[0.18em] text-amber-200">{sourceLabel}</span>
          <span className="mt-0.5 block max-w-[118px] truncate text-xs font-bold text-slate-100">
            {featured ? `${featured.ticker} ${featured.title}` : "新着なし"}
          </span>
        </span>
        <span className={unreadItems.length ? "grid size-8 shrink-0 place-items-center rounded-full bg-amber-300 text-xs font-black text-neutral-950" : "grid size-8 shrink-0 place-items-center rounded-full border border-white/10 bg-black/30 text-xs font-black text-slate-400"}>
          {unreadItems.length || latestNews.length}
        </span>
      </button>

      {open ? (
        <div className="absolute right-0 top-[calc(100%+10px)] z-30 w-[min(92vw,420px)] overflow-hidden rounded-2xl border border-white/10 bg-neutral-950 shadow-2xl shadow-black/50 ring-1 ring-white/5">
          <div className="border-b border-white/10 bg-[linear-gradient(180deg,rgba(245,158,11,0.14),rgba(2,6,23,0.70))] p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-amber-200">Latest News</p>
                <h3 className="mt-1 text-lg font-black text-white">新着ニュース通知</h3>
              </div>
              <span className="rounded-full border border-white/10 bg-black/35 px-2.5 py-1 text-xs font-black text-slate-300">
                {unreadItems.length ? `未読 ${unreadItems.length}` : "確認済み"}
              </span>
            </div>
            <p className="mt-2 text-xs leading-5 text-slate-400">
              AI Job / NewsAPI で取得されたWatchlist銘柄の最新ニュースです。
            </p>
          </div>

          <div className="max-h-[420px] overflow-y-auto p-2">
            {latestNews.length ? latestNews.slice(0, 6).map((item) => (
              <Link
                key={newsIdentity(item)}
                className="block rounded-xl border border-transparent p-3 transition hover:border-amber-300/25 hover:bg-amber-300/10"
                href={`/news?highlight=${encodeURIComponent(item.ticker)}`}
                onClick={() => setOpen(false)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-md border border-sky-300/25 bg-sky-300/10 px-2 py-0.5 text-[10px] font-black text-sky-100">{item.ticker}</span>
                      <span className={sentimentClass(item.sentiment)}>{item.sentiment}</span>
                      <span className="text-[11px] font-semibold text-slate-500">{formatNewsTime(item.publishedAt)}</span>
                    </div>
                    <p className="mt-2 line-clamp-2 text-sm font-black leading-5 text-slate-100">{item.title}</p>
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-400">{item.summary}</p>
                  </div>
                  <span className="shrink-0 rounded-lg border border-white/10 bg-white/[0.06] px-2 py-1 text-xs font-black text-amber-100">
                    {item.impactScore}/10
                  </span>
                </div>
              </Link>
            )) : (
              <div className="p-4 text-sm leading-6 text-slate-400">
                まだ新着ニュースはありません。AI Job が成功するとここに表示されます。
              </div>
            )}
          </div>

          <div className="border-t border-white/10 p-3">
            <Link
              className="flex items-center justify-between rounded-xl border border-amber-300/25 bg-amber-300/10 px-4 py-3 text-sm font-black text-amber-100 transition hover:bg-amber-300/18"
              href="/news"
              onClick={() => setOpen(false)}
            >
              <span>Newsページで全部見る</span>
              <span>›</span>
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function normalizeLatestNews(items: NewsItem[]) {
  const seen = new Set<string>();
  return items
    .filter((item) => {
      const key = newsIdentity(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
}

function readSeenNewsKeys() {
  if (typeof window === "undefined") return new Set<string>();
  const stored = localStorage.getItem(seenNewsStorageKey);
  if (!stored) return new Set<string>();
  try {
    const parsed = JSON.parse(stored) as unknown;
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return new Set<string>();
  }
}

function writeSeenNewsKeys(keys: Set<string>) {
  localStorage.setItem(seenNewsStorageKey, JSON.stringify([...keys].slice(-300)));
}

function sentimentClass(sentiment: NewsItem["sentiment"]) {
  if (sentiment === "Positive") return "rounded-md border border-emerald-300/25 bg-emerald-300/10 px-2 py-0.5 text-[10px] font-black text-emerald-100";
  if (sentiment === "Negative") return "rounded-md border border-rose-300/25 bg-rose-300/10 px-2 py-0.5 text-[10px] font-black text-rose-100";
  return "rounded-md border border-slate-300/15 bg-white/[0.06] px-2 py-0.5 text-[10px] font-black text-slate-300";
}

function formatNewsTime(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}
