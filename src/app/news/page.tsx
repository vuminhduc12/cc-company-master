"use client";

import { useMemo, useState } from "react";
import { LiveWatchlistStrip } from "@/components/LiveWatchlistStrip";
import { MarketBadge, MarketFilterButton, countWatchlistLists, filterItemsByWatchlistList, marketForWatchItem, type StockMarket } from "@/components/MarketControls";
import { NewsCard } from "@/components/NewsCard";
import { news } from "@/lib/mock-data";
import { countStaleNews, filterFreshNews, freshNewsWindowDays } from "@/lib/news-freshness";
import { resolveVisibleWatchlist } from "@/lib/watchlist-display";
import { useUserWatchlist } from "@/lib/user-watchlist";
import { hiddenNewsStorageKey, hideNewsItem, newsIdentity, useAiJobResult } from "@/lib/use-ai-job-result";
import { useWatchlistLists } from "@/lib/watchlist-lists";
import type { NewsItem, WatchlistItem } from "@/types";

export default function NewsPage() {
  const jobResult = useAiJobResult();
  const listManager = useWatchlistLists();
  const userWatchlist = useUserWatchlist();
  const visibleWatchlist = resolveVisibleWatchlist(userWatchlist.items);
  const [newsListId, setNewsListId] = useState("all");
  const [hiddenNews, setHiddenNews] = useState<Set<string>>(() => readHiddenNewsKeys());
  const allVisibleItems = (jobResult?.news ?? news).filter((item) => !hiddenNews.has(newsIdentity(item)));
  const staleCount = countStaleNews(allVisibleItems);
  const items = filterFreshNews(allVisibleItems);
  const listCounts = useMemo(() => countWatchlistLists(listManager.lists, visibleWatchlist), [listManager.lists, visibleWatchlist]);
  const marketWatchlist = useMemo(
    () => filterItemsByWatchlistList(visibleWatchlist, newsListId),
    [newsListId, visibleWatchlist]
  );
  const marketTickerSet = useMemo(() => new Set(marketWatchlist.map((item) => item.stock.ticker)), [marketWatchlist]);
  const marketItems = useMemo(
    () => newsListId === "all" ? items : items.filter((item) => marketTickerSet.has(item.ticker)),
    [items, marketTickerSet, newsListId]
  );
  const tickerTabs = useMemo(() => buildTickerTabs(marketItems, marketWatchlist), [marketItems, marketWatchlist]);
  const [selectedTicker, setSelectedTicker] = useState("ALL");
  const activeTicker = selectedTicker === "ALL" || tickerTabs.some((tab) => tab.ticker === selectedTicker) ? selectedTicker : "ALL";
  const filteredItems = activeTicker === "ALL" ? marketItems : marketItems.filter((item) => item.ticker === activeTicker);
  const featured = filteredItems[0];
  const positiveCount = filteredItems.filter((item) => item.sentiment === "Positive").length;
  const negativeCount = filteredItems.filter((item) => item.sentiment === "Negative").length;
  const highImpactCount = filteredItems.filter((item) => item.impactScore >= 8).length;
  const averageImpact = filteredItems.length > 0 ? filteredItems.reduce((sum, item) => sum + item.impactScore, 0) / filteredItems.length : 0;
  const activeListName = listManager.lists.find((list) => list.id === newsListId)?.name ?? "全Watchlist";
  const activeTickerName = activeTicker === "ALL" ? "全銘柄" : tickerTabs.find((tab) => tab.ticker === activeTicker)?.name ?? activeTicker;

  function deleteNews(item: NewsItem) {
    hideNewsItem(item);
    setHiddenNews(readHiddenNewsKeys());
  }

  return (
    <div className="space-y-6">
      <LiveWatchlistStrip />
      <div className="rounded-3xl border border-white/10 bg-slate-900/80 p-6 shadow-xl shadow-black/25 ring-1 ring-white/5">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-300">News Intelligence</p>
            <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-50">AIニュース分析</h2>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              {jobResult ? `海外ニュースを日本語で分析 / 最終AI分析: ${jobResult.lastRun}` : "mock-dataを表示中"}。{freshNewsWindowDays}日以内のニュースだけを自動表示します。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a className="rounded-full border border-sky-300/30 bg-sky-300/10 px-4 py-2 text-sm font-semibold text-sky-100 hover:bg-sky-300/20" href={financeUrl(activeTicker, visibleWatchlist)} target="_blank" rel="noreferrer">
              Google Financeで確認 ↗
            </a>
            <div className="rounded-full border border-white/10 bg-slate-950/55 px-4 py-2 text-sm text-slate-300">
              {jobResult ? "Supabase / 最新AI分析" : "mock-data"}
            </div>
            <div className="rounded-full border border-yellow-300/25 bg-yellow-300/10 px-4 py-2 text-sm text-yellow-100">
              古いニュース非表示: {staleCount}件
            </div>
          </div>
        </div>
      </div>
      {jobResult?.error ? (
        <div className="rounded-2xl border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-200">
          Error: {jobResult.error}
        </div>
      ) : null}

      <section className="rounded-2xl border border-sky-300/20 bg-sky-300/[0.07] p-4 shadow-xl shadow-black/20 ring-1 ring-white/5">
        <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-sky-300">Current View</p>
            <h3 className="mt-1 text-xl font-black text-slate-50">{activeListName} / {activeTickerName}</h3>
            <p className="mt-1 text-xs leading-5 text-slate-400">赤は最重要、緑は好材料、赤系は悪材料です。まず重要度と銘柄位置を確認してください。</p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <MiniSignal label="最重要" value={`${highImpactCount}`} tone="red" />
            <MiniSignal label="好材料" value={`${positiveCount}`} tone="green" />
            <MiniSignal label="悪材料" value={`${negativeCount}`} tone="red" />
          </div>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-4">
        <Metric label="表示ニュース" value={`${filteredItems.length}件`} />
        <Metric label="Positive" value={`${positiveCount}件`} tone="green" />
        <Metric label="Negative" value={`${negativeCount}件`} tone="red" />
        <Metric label="平均影響度" value={`${averageImpact.toFixed(1)}/10`} tone="blue" />
      </section>

      <section className="sticky top-0 z-10 -mx-2 rounded-2xl border border-white/10 bg-[#020617]/95 p-3 shadow-xl shadow-black/20 ring-1 ring-white/5 backdrop-blur sm:static sm:mx-0 sm:bg-slate-900/75">
        <div className="mb-3 flex flex-wrap gap-2">
          {listManager.lists.map((list) => (
            <MarketFilterButton key={list.id} active={newsListId === list.id} count={listCounts[list.id] ?? 0} label={list.name} onClick={() => setNewsListId(list.id)} />
          ))}
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch]">
          <TickerFilterButton
            active={activeTicker === "ALL"}
            count={marketItems.length}
            label="All"
            onClick={() => setSelectedTicker("ALL")}
            ticker="ALL"
          />
          {tickerTabs.map((tab) => (
            <TickerFilterButton
              key={tab.ticker}
              active={activeTicker === tab.ticker}
              count={tab.count}
              label={tab.name}
              market={tab.market}
              onClick={() => setSelectedTicker(tab.ticker)}
              ticker={tab.ticker}
            />
          ))}
        </div>
      </section>

      {featured ? <NewsCard item={featured} featured onDelete={deleteNews} /> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {filteredItems.slice(1).map((item, index) => <NewsCard key={newsKey(item, index + 1)} item={item} onDelete={deleteNews} />)}
      </div>
      {filteredItems.length === 0 ? (
        <div className="rounded-2xl border border-yellow-300/25 bg-yellow-300/10 p-5 text-sm leading-6 text-yellow-100">
          {allVisibleItems.length > 0
            ? `${freshNewsWindowDays}日以内のニュースがないため非表示です。Manual AI Jobで最新ニュースを取得してください。`
            : "この銘柄のニュースはまだありません。Manual AI Job または Cron が成功すると、Watchlist銘柄ごとのニュースがここに表示されます。"}
        </div>
      ) : null}
    </div>
  );
}

function TickerFilterButton({ active, count, label, market, onClick, ticker }: { active: boolean; count: number; label: string; market?: StockMarket; onClick: () => void; ticker: string }) {
  const activeStyle = ticker === "ALL"
    ? "border-slate-200/30 bg-slate-100 text-slate-950"
    : "border-sky-300/40 bg-sky-300 text-slate-950";

  return (
    <button
      className={`grid min-w-[150px] grid-cols-[1fr_auto] items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition ${
        active ? activeStyle : "border-white/10 bg-slate-950/60 text-slate-300 hover:border-sky-300/30 hover:bg-sky-300/10 hover:text-sky-100"
      }`}
      onClick={onClick}
      type="button"
    >
      <span className="min-w-0">
        <span className="flex items-center gap-2">
          <span className="block text-xs font-black uppercase tracking-[0.18em]">{ticker}</span>
          {market ? <MarketBadge market={market} compact /> : null}
        </span>
        <span className="block truncate text-[11px] font-semibold opacity-75">{label}</span>
      </span>
      <span className={`rounded-full px-2 py-1 text-xs font-black ${active ? "bg-slate-950/15" : "bg-white/10"}`}>{count}</span>
    </button>
  );
}

function MiniSignal({ label, value, tone }: { label: string; value: string; tone: "green" | "red" }) {
  return (
    <div className={tone === "green" ? "rounded-xl border border-green-300/20 bg-green-300/10 px-3 py-2" : "rounded-xl border border-red-300/20 bg-red-300/10 px-3 py-2"}>
      <p className={tone === "green" ? "text-[10px] font-bold text-green-200" : "text-[10px] font-bold text-red-200"}>{label}</p>
      <p className={tone === "green" ? "mt-1 text-lg font-black text-green-100" : "mt-1 text-lg font-black text-red-100"}>{value}</p>
    </div>
  );
}

function Metric({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "green" | "red" | "blue" }) {
  const color = {
    default: "text-slate-50",
    green: "text-green-300",
    red: "text-red-300",
    blue: "text-sky-300"
  }[tone];

  return (
    <div className="rounded-2xl border border-white/10 bg-slate-900/75 p-4">
      <p className="text-xs text-slate-400">{label}</p>
      <p className={`mt-1 text-xl font-bold ${color}`}>{value}</p>
    </div>
  );
}

function newsKey(item: { publishedAt: string; ticker: string; title: string; url?: string }, index: number) {
  return `${item.ticker}-${item.publishedAt}-${item.url ?? item.title}-${index}`;
}

function buildTickerTabs(items: typeof news, visibleWatchlist: WatchlistItem[]) {
  return visibleWatchlist.map((item) => ({
    ticker: item.stock.ticker,
    name: item.stock.companyName,
    market: marketForWatchItem(item),
    count: items.filter((newsItem) => newsItem.ticker === item.stock.ticker).length
  }));
}

function financeUrl(ticker: string, visibleWatchlist: WatchlistItem[]) {
  if (ticker === "ALL") return "https://www.google.com/finance";
  const stock = visibleWatchlist.find((item) => item.stock.ticker === ticker)?.stock;
  const exchange = stock?.exchange === "NYSE" ? "NYSE" : stock?.exchange === "NASDAQ" ? "NASDAQ" : "";
  return exchange ? `https://www.google.com/finance/quote/${ticker}:${exchange}` : `https://www.google.com/finance/search?q=${encodeURIComponent(ticker)}`;
}

function readHiddenNewsKeys() {
  if (typeof window === "undefined") return new Set<string>();
  const stored = localStorage.getItem(hiddenNewsStorageKey);
  if (!stored) return new Set<string>();
  try {
    const parsed = JSON.parse(stored) as unknown;
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return new Set<string>();
  }
}
