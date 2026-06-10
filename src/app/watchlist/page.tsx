"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { DataTable } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { authHeaders } from "@/lib/auth-fetch";
import { stockDataProviderPriorityLabel } from "@/lib/data-provider-policy";
import { resolvePriceSeries } from "@/lib/indicators";
import { pricesByTicker, watchlist } from "@/lib/mock-data";
import { statusFromScore } from "@/lib/scoring";
import {
  customWatchlistStorageKey,
  isJapaneseTicker,
  loadCustomWatchItems,
  loadDbWatchlistState,
  loadRemovedWatchTickers,
  markDbWatchTickerRemoved,
  migrateLocalWatchlistToDb,
  normalizeTickerForMarket,
  removedWatchlistStorageKey,
  restoreDbRemovedDefaults,
  saveDbWatchItem,
  type CustomWatchItem,
  type SearchMarket
} from "@/lib/user-watchlist";
import { useAiJobResult } from "@/lib/use-ai-job-result";
import { useSupabaseAuth } from "@/lib/use-supabase-auth";
import type { DailyPrice, Stock, WatchStatus } from "@/types";
import { planDefinitions, type PlanDefinition } from "@/lib/plans";

type WatchlistLookupResult = {
  ok: true;
  mode: "live" | "mock";
  provider: "yahoo" | "alpha_vantage" | "saved" | "local";
  stock: Stock;
  price: DailyPrice;
  previousClose: number;
  score: number;
  status: WatchStatus;
  warning?: string;
  fetchedAt: string;
};

export default function WatchlistPage() {
  const jobResult = useAiJobResult();
  const auth = useSupabaseAuth();
  const [market, setMarket] = useState<SearchMarket>("us");
  const [ticker, setTicker] = useState("RGTI");
  const [customItems, setCustomItems] = useState<CustomWatchItem[]>([]);
  const [removedTickers, setRemovedTickers] = useState<string[]>([]);
  const [lookupResult, setLookupResult] = useState<WatchlistLookupResult | null>(null);
  const [searchStatus, setSearchStatus] = useState<"idle" | "running" | "error">("idle");
  const [refreshStatus, setRefreshStatus] = useState<"idle" | "running" | "error">("idle");
  const [message, setMessage] = useState("");
  const [storageReady, setStorageReady] = useState(false);
  const [syncMode, setSyncMode] = useState<"checking" | "local" | "supabase">("checking");
  const [plan, setPlan] = useState<PlanDefinition>(planDefinitions.free);
  const defaultTickerSet = useMemo(() => new Set(watchlist.map((item) => item.stock.ticker)), []);

  useEffect(() => {
    if (auth.loading) return;
    if (auth.user?.id) return;
    setCustomItems(loadCustomWatchItems());
    setRemovedTickers(loadRemovedWatchTickers());
    setSyncMode("local");
    setStorageReady(true);
  }, [auth.loading, auth.user?.id]);

  useEffect(() => {
    if (!storageReady || syncMode !== "local") return;
    localStorage.setItem(customWatchlistStorageKey, JSON.stringify(customItems));
  }, [customItems, storageReady, syncMode]);

  useEffect(() => {
    if (!storageReady || syncMode !== "local") return;
    localStorage.setItem(removedWatchlistStorageKey, JSON.stringify(removedTickers));
  }, [removedTickers, storageReady, syncMode]);

  useEffect(() => {
    if (auth.loading) return;
    const userId = auth.user?.id;
    if (!userId) {
      setSyncMode("local");
      setStorageReady(true);
      return;
    }
    let cancelled = false;
    async function loadDbState(activeUserId: string) {
      setSyncMode("checking");
      const localCustom = loadCustomWatchItems();
      const localRemoved = loadRemovedWatchTickers();
      const dbState = await loadDbWatchlistState(activeUserId);
      if (cancelled) return;
      if (!dbState) {
        setCustomItems(localCustom);
        setRemovedTickers(localRemoved);
        setSyncMode("local");
        setStorageReady(true);
        setMessage("Supabase Watchlistを読み込めなかったため、localStorageで表示しています。SQL/RLS設定を確認してください。");
        return;
      }
      if (dbState.customItems.length === 0 && dbState.removedTickers.length === 0 && (localCustom.length || localRemoved.length)) {
        await migrateLocalWatchlistToDb(activeUserId, localCustom, localRemoved);
        if (!cancelled) {
          setCustomItems(localCustom);
          setRemovedTickers(localRemoved);
          setSyncMode("supabase");
          setStorageReady(true);
          setMessage("ローカルWatchlistをSupabaseへ移行しました。");
        }
        return;
      }
      setCustomItems(dbState.customItems);
      setRemovedTickers(dbState.removedTickers);
      setSyncMode("supabase");
      setStorageReady(true);
    }
    void loadDbState(userId);
    return () => {
      cancelled = true;
    };
  }, [auth.loading, auth.user?.id]);

  useEffect(() => {
    async function loadPlan() {
      try {
        const response = await fetch("/api/plan/summary", {
          cache: "no-store",
          headers: await authHeaders()
        });
        const payload = await response.json() as { ok: true; plan: PlanDefinition } | { ok: false };
        if (response.ok && payload.ok) setPlan(payload.plan);
      } catch {
        setPlan(planDefinitions.free);
      }
    }
    void loadPlan();
  }, [auth.user]);

  const defaultItems = useMemo(() => {
    return watchlist.filter((item) => !removedTickers.includes(item.stock.ticker)).map<CustomWatchItem>((item) => {
      const live = jobResult?.stocks?.find((stockResult) => stockResult.stock.ticker === item.stock.ticker);
      const rowBasePrices = pricesByTicker[item.stock.ticker];
      const rowResolved = rowBasePrices ? resolvePriceSeries(rowBasePrices, live?.prices, live?.price) : null;
      const rowLatest = rowResolved?.prices.at(-1);
      const currentPrice = rowLatest?.close ?? live?.price.close ?? item.currentPrice;
      const previousClose = rowResolved?.prices.at(-2)?.close ?? (live ? currentPrice / (1 + live.price.changePercent / 100) : item.previousClose);
      return {
        stock: item.stock,
        shares: item.shares,
        averagePrice: item.averagePrice,
        currentPrice,
        previousClose,
        status: live?.status ?? (jobResult && item.stock.ticker === "RGTI" ? statusFromScore(jobResult.aiMarketScore) : item.status),
        memo: live ? `Data Freshness: ${live.dataFreshness}` : item.memo,
        market: isJapaneseTicker(item.stock.ticker) ? "jp" : "us",
        score: live?.aiMarketScore ?? (item.stock.ticker === "RGTI" && jobResult ? jobResult.aiMarketScore : undefined),
        source: live ? "AI Job" : "Local default",
        fetchedAt: live?.dataFreshness,
      };
    });
  }, [jobResult, removedTickers]);

  const visibleItems = useMemo(() => {
    const map = new Map<string, CustomWatchItem>();
    [...defaultItems, ...customItems].forEach((item) => {
      if (!removedTickers.includes(item.stock.ticker)) map.set(item.stock.ticker, item);
    });
    return [...map.values()].sort((a, b) => a.stock.ticker.localeCompare(b.stock.ticker));
  }, [customItems, defaultItems, removedTickers]);

  async function searchTicker() {
    const normalized = normalizeTickerForMarket(ticker, market);
    if (!normalized) return;
    setSearchStatus("running");
    setMessage("");
    try {
      const result = await lookupTicker(normalized, market);
      setLookupResult(result);
      setTicker(result.stock.ticker);
      setSearchStatus("idle");
      setMessage(`${result.stock.ticker}のリアルデータを取得しました。追加ボタンでWatchlistに保存できます。`);
    } catch (error) {
      setLookupResult(null);
      setSearchStatus("error");
      setMessage(error instanceof Error ? error.message : "検索に失敗しました。");
    }
  }

  function addLookupResult() {
    if (!lookupResult) return;
    const alreadyVisible = visibleItems.some((row) => row.stock.ticker === lookupResult.stock.ticker);
    if (!alreadyVisible && visibleItems.length >= plan.watchlistItems) {
      setSearchStatus("error");
      setMessage(`Watchlist上限は${plan.watchlistItems}銘柄です。不要な銘柄を削除してください。`);
      return;
    }
    const item: CustomWatchItem = {
      stock: lookupResult.stock,
      shares: 0,
      averagePrice: 0,
      currentPrice: lookupResult.price.close,
      previousClose: lookupResult.previousClose,
      status: lookupResult.status,
      memo: lookupResult.warning ?? `${lookupResult.provider} / ${lookupResult.mode} / ${formatDateTime(lookupResult.fetchedAt)}`,
      market,
      score: lookupResult.score,
      source: lookupResult.provider,
      fetchedAt: lookupResult.fetchedAt,
      latestPrice: lookupResult.price
    };
    setRemovedTickers((current) => current.filter((tickerValue) => tickerValue !== item.stock.ticker));
    setCustomItems((current) => [item, ...current.filter((row) => row.stock.ticker !== item.stock.ticker)]);
    if (auth.user) void saveDbWatchItem(auth.user.id, item);
    setMessage(`${item.stock.ticker}をWatchlistに追加しました。${auth.user ? " Supabaseにも保存しました。" : ""}`);
  }

  function deleteTicker(tickerToDelete: string) {
    setCustomItems((current) => current.filter((item) => item.stock.ticker !== tickerToDelete));
    setRemovedTickers((current) => current.includes(tickerToDelete) ? current : [...current, tickerToDelete]);
    if (lookupResult?.stock.ticker === tickerToDelete) setLookupResult(null);
    if (auth.user) void markDbWatchTickerRemoved(auth.user.id, tickerToDelete, isJapaneseTicker(tickerToDelete) ? "jp" : "us");
    setMessage(`${tickerToDelete}をWatchlistから削除しました。${auth.user ? " Supabaseにも反映しました。" : ""}`);
  }

  function restoreDefaults() {
    setRemovedTickers([]);
    if (auth.user) void restoreDbRemovedDefaults(auth.user.id);
    setMessage(`初期Watchlist銘柄を復元しました。${auth.user ? " Supabaseにも反映しました。" : ""}`);
  }

  async function refreshAll() {
    if (visibleItems.length === 0) return;
    setRefreshStatus("running");
    setMessage("");
    try {
      const refreshed: CustomWatchItem[] = [];
      for (const item of visibleItems) {
        const result = await lookupTicker(item.stock.ticker, item.market);
        refreshed.push({
          ...item,
          stock: result.stock,
          currentPrice: result.price.close,
          previousClose: result.previousClose,
          status: result.status,
          score: result.score,
          source: result.provider,
          fetchedAt: result.fetchedAt,
          memo: result.warning ?? `${result.provider} / ${result.mode} / ${formatDateTime(result.fetchedAt)}`,
          latestPrice: result.price
        });
      }
      setCustomItems((current) => {
        const refreshedMap = new Map(refreshed.map((item) => [item.stock.ticker, item]));
        const nextCustom = current.map((item) => refreshedMap.get(item.stock.ticker) ?? item);
        refreshed.forEach((item) => {
          if (!nextCustom.some((row) => row.stock.ticker === item.stock.ticker)) {
            nextCustom.push(item);
          }
        });
        return nextCustom;
      });
      setRefreshStatus("idle");
      setMessage(`${refreshed.length}銘柄をリアルデータで更新しました。`);
    } catch (error) {
      setRefreshStatus("error");
      setMessage(error instanceof Error ? error.message : "更新に失敗しました。");
    }
  }

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-3xl border border-white/10 bg-slate-900/80 shadow-xl shadow-black/25 ring-1 ring-white/5">
        <div className="grid gap-0 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="min-w-0 p-5 sm:p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-300">Portfolio Monitor</p>
            <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-50">Watchlist</h2>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-400">
              米国株・国内株を検索して、リアル株価を取得した銘柄をWatchlistに追加できます。削除した銘柄と追加銘柄はブラウザに保存されます。
            </p>
            <p className="mt-2 rounded-xl border border-emerald-300/20 bg-emerald-300/[0.06] px-3 py-2 text-xs leading-5 text-emerald-100">
              データ取得優先順位: <span className="font-black">{stockDataProviderPriorityLabel}</span>
            </p>
            <p className="mt-2 rounded-xl border border-cyan-300/20 bg-cyan-300/[0.06] px-3 py-2 text-xs leading-5 text-cyan-100">
              保存モード: <span className="font-black">{syncMode === "checking" ? "同期確認中" : syncMode === "supabase" ? `Supabase DB同期 (${auth.email})` : "localStorage"}</span>
              <span className="text-cyan-100/75">。ログインすると別端末でもWatchlistを復元できます。</span>
            </p>
            <p className="mt-2 rounded-xl border border-fuchsia-300/20 bg-fuchsia-300/[0.06] px-3 py-2 text-xs leading-5 text-fuchsia-100">
              現在プラン: <span className="font-black">{plan.name}</span>（課金機能は未導入・制限緩和中）
            </p>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <WatchStat label="表示銘柄" value={`${visibleItems.length}`} tone="default" />
              <WatchStat label="追加銘柄" value={`${customItems.filter((item) => !defaultTickerSet.has(item.stock.ticker)).length}`} tone="green" />
              <WatchStat label="削除済み初期銘柄" value={`${removedTickers.length}`} tone="yellow" />
            </div>
          </div>
          <div className="border-t border-white/10 bg-slate-950/45 p-5 sm:p-6 xl:border-l xl:border-t-0">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-purple-200">Realtime Search</p>
            <div className="mt-4 grid grid-cols-2 overflow-hidden rounded-2xl border border-white/10 bg-slate-950 p-1">
              {([
                ["us", "米国株"],
                ["jp", "国内株"]
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  className={market === value ? "rounded-xl bg-[#6f2da8] px-3 py-2 text-sm font-black text-white" : "rounded-xl px-3 py-2 text-sm font-bold text-slate-400 hover:bg-white/5 hover:text-slate-100"}
                  onClick={() => {
                    setMarket(value);
                    setTicker(value === "jp" ? "7203" : "RGTI");
                    setLookupResult(null);
                    setMessage("");
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              <input
                className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 text-sm font-black uppercase text-slate-50 outline-none focus:border-purple-300/60"
                value={ticker}
                onChange={(event) => setTicker(event.target.value.toUpperCase())}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void searchTicker();
                }}
                placeholder={market === "jp" ? "例: 7203" : "例: RGTI"}
              />
              <button
                className="rounded-2xl bg-sky-300 px-4 py-3 text-sm font-black text-slate-950 hover:bg-sky-200 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={searchStatus === "running"}
                onClick={() => void searchTicker()}
              >
                {searchStatus === "running" ? "検索中" : "検索"}
              </button>
            </div>
            {lookupResult ? (
              <div className="mt-4 rounded-2xl border border-purple-300/25 bg-purple-300/10 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-lg font-black text-slate-50">{lookupResult.stock.ticker}</p>
                    <p className="mt-1 truncate text-sm text-slate-300">{lookupResult.stock.companyName}</p>
                  </div>
                  <StatusBadge value={lookupResult.status} />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <MiniMetric label="現在値" value={formatPrice(lookupResult.stock.ticker, lookupResult.price.close)} />
                  <MiniMetric label="スコア" value={`${lookupResult.score}`} />
                </div>
                <button
                  className="mt-3 w-full rounded-2xl bg-green-300 px-4 py-2.5 text-sm font-black text-slate-950 hover:bg-green-200"
                  onClick={addLookupResult}
                >
                  Watchlistに追加
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <section className="flex flex-col justify-between gap-3 lg:flex-row lg:items-end">
        <div>
          <h3 className="text-lg font-bold text-slate-50">銘柄一覧</h3>
          <p className="mt-1 text-xs text-slate-500">保有情報、現在値、AI/ルールステータス、データソースを確認できます。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="rounded-full border border-sky-300/30 bg-sky-300/10 px-4 py-2 text-xs font-black text-sky-100 hover:bg-sky-300/20 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={refreshStatus === "running" || visibleItems.length === 0}
            onClick={() => void refreshAll()}
          >
            {refreshStatus === "running" ? "更新中..." : "全部リアル更新"}
          </button>
          <button
            className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-black text-slate-200 hover:bg-white/10"
            onClick={restoreDefaults}
          >
            初期銘柄を復元
          </button>
        </div>
      </section>

      {message ? (
        <div className={searchStatus === "error" || refreshStatus === "error" ? "rounded-2xl border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-200" : "rounded-2xl border border-sky-300/25 bg-sky-300/10 p-4 text-sm text-sky-100"}>
          {message}
        </div>
      ) : null}
      {jobResult?.error ? (
        <div className="rounded-2xl border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-200">
          Error: {jobResult.error}
        </div>
      ) : null}

      {!storageReady ? (
        <div className="rounded-2xl border border-cyan-300/25 bg-cyan-300/10 p-5 text-sm leading-6 text-cyan-100">
          Watchlistの保存元を確認中です。下の初期銘柄はそのまま表示しています。
        </div>
      ) : null}

      <DataTable
          headers={["Ticker", "会社名", "市場", "現在値", "前日比", "スコア", "ステータス", "ソース", "メモ", "操作"]}
          rows={visibleItems.map((item) => {
          const change = item.previousClose > 0 ? ((item.currentPrice - item.previousClose) / item.previousClose) * 100 : 0;
          return [
            <Link key="ticker" className="font-bold text-sky-300 hover:text-sky-200" href={`/stocks/${item.stock.ticker}`}>
              {item.stock.ticker}
            </Link>,
            item.stock.companyName,
            item.stock.exchange,
            formatPrice(item.stock.ticker, item.currentPrice),
            <span key="change" className={change >= 0 ? "font-semibold text-green-400" : "font-semibold text-red-400"}>{change ? `${change >= 0 ? "+" : ""}${change.toFixed(2)}%` : "-"}</span>,
            item.score ?? "-",
            <StatusBadge key="status" value={item.status} />,
            item.source ?? "-",
            item.memo,
            <button
              key="delete"
              className="rounded-full border border-red-300/30 bg-red-400/10 px-3 py-1.5 text-xs font-black text-red-200 hover:bg-red-400/20"
              onClick={() => deleteTicker(item.stock.ticker)}
            >
              削除
            </button>
          ];
          })}
        />
    </div>
  );
}

async function lookupTicker(ticker: string, market: SearchMarket): Promise<WatchlistLookupResult> {
  const response = await fetch("/api/watchlist/lookup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ticker, market })
  });
  const result = await response.json() as WatchlistLookupResult | { ok: false; error?: string };
  if (!response.ok || !result.ok) throw new Error("error" in result ? result.error ?? "銘柄検索に失敗しました。" : "銘柄検索に失敗しました。");
  return result;
}

function formatPrice(ticker: string, value: number) {
  if (!Number.isFinite(value)) return "-";
  if (isJapaneseTicker(ticker)) return `${Math.round(value).toLocaleString("ja-JP")}円`;
  return `$${value.toFixed(2)}`;
}

function formatDateTime(value: string | undefined) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function WatchStat({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "green" | "yellow" }) {
  const color = {
    default: "text-sky-200",
    green: "text-green-200",
    yellow: "text-yellow-200"
  }[tone];
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/55 p-4">
      <p className="text-xs font-semibold text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-black ${color}`}>{value}</p>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-950/60 p-3">
      <p className="text-xs font-semibold text-slate-500">{label}</p>
      <p className="mt-1 font-black text-slate-50">{value}</p>
    </div>
  );
}
