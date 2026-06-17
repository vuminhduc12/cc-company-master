"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { DataTable } from "@/components/DataTable";
import { MarketBadge, MarketFilterButton, countWatchlistMarkets, marketForWatchItem } from "@/components/MarketControls";
import { StatusBadge } from "@/components/StatusBadge";
import { authHeaders } from "@/lib/auth-fetch";
import { stockDataProviderPriorityLabel } from "@/lib/data-provider-policy";
import { watchlist } from "@/lib/mock-data";
import {
  isJapaneseTicker,
  markDbWatchTickerRemoved,
  normalizeTickerForMarket,
  restoreDbRemovedDefaults,
  saveDbWatchItem,
  useUserWatchlist,
  type CustomWatchItem,
  type SearchMarket,
  type WatchlistList,
  type WatchlistListMarket
} from "@/lib/user-watchlist";
import { useSupabaseAuth } from "@/lib/use-supabase-auth";
import { useWatchlistLists } from "@/lib/watchlist-lists";
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
  const auth = useSupabaseAuth();
  const {
    items: visibleItems,
    customItems,
    removedTickers,
    ready,
    syncMode,
    syncError,
    refreshStatus,
    refreshMessage,
    setCustomItems,
    setRemovedTickers,
    refreshAll
  } = useUserWatchlist();
  const [market, setMarket] = useState<SearchMarket>("us");
  const [ticker, setTicker] = useState("RGTI");
  const [lookupResult, setLookupResult] = useState<WatchlistLookupResult | null>(null);
  const [searchStatus, setSearchStatus] = useState<"idle" | "running" | "error">("idle");
  const [message, setMessage] = useState("");
  const [plan, setPlan] = useState<PlanDefinition>(planDefinitions.free);
  const [activeListId, setActiveListId] = useState("all");
  const [targetListId, setTargetListId] = useState("us");
  const [newListName, setNewListName] = useState("");
  const [newListMarket, setNewListMarket] = useState<WatchlistListMarket>("all");
  const [deleteCandidate, setDeleteCandidate] = useState<WatchlistList | null>(null);
  const listManager = useWatchlistLists();
  const authUserId = auth.user?.id ?? "";
  const defaultTickerSet = useMemo(() => new Set(watchlist.map((item) => item.stock.ticker)), []);
  const isSyncChecking = !ready || syncMode === "checking";
  const marketCounts = useMemo(() => countWatchlistMarkets(visibleItems), [visibleItems]);
  const listCounts = useMemo(() => countLists(listManager.lists, visibleItems), [listManager.lists, visibleItems]);
  const filteredItems = useMemo(
    () => filterItemsByList(visibleItems, activeListId),
    [activeListId, visibleItems]
  );
  const targetLists = useMemo(
    () => listManager.lists.filter((list) => list.market === "all" || list.market === market),
    [listManager.lists, market]
  );

  useEffect(() => {
    const fallback = market === "jp" ? "jp" : "us";
    if (!targetLists.some((list) => list.id === targetListId)) setTargetListId(fallback);
  }, [market, targetListId, targetLists]);

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
  }, [authUserId]);

  useEffect(() => {
    if (refreshMessage) setMessage(refreshMessage);
  }, [refreshMessage]);

  async function searchTicker() {
    if (isSyncChecking) return;
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
    if (!lookupResult || isSyncChecking) return;
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
    const itemWithList = attachListToItem(item, targetListId);
    setRemovedTickers((current) => current.filter((tickerValue) => tickerValue !== item.stock.ticker));
    setCustomItems((current) => [itemWithList, ...current.filter((row) => row.stock.ticker !== item.stock.ticker)]);
    if (auth.user) void saveDbWatchItem(auth.user.id, itemWithList);
    setMessage(`${item.stock.ticker}を「${listNameById(listManager.lists, targetListId)}」に追加しました。${auth.user ? " Supabaseにも保存しました。" : ""}`);
  }

  function deleteTicker(tickerToDelete: string) {
    if (isSyncChecking) return;
    setCustomItems((current) => current.filter((item) => item.stock.ticker !== tickerToDelete));
    setRemovedTickers((current) => current.includes(tickerToDelete) ? current : [...current, tickerToDelete]);
    if (lookupResult?.stock.ticker === tickerToDelete) setLookupResult(null);
    if (auth.user) void markDbWatchTickerRemoved(auth.user.id, tickerToDelete, isJapaneseTicker(tickerToDelete) ? "jp" : "us");
    setMessage(`${tickerToDelete}をWatchlistから削除しました。${auth.user ? " Supabaseにも反映しました。" : ""}`);
  }

  function restoreDefaults() {
    if (isSyncChecking) return;
    setRemovedTickers([]);
    if (auth.user) void restoreDbRemovedDefaults(auth.user.id);
    setMessage(`初期Watchlist銘柄を復元しました。${auth.user ? " Supabaseにも反映しました。" : ""}`);
  }

  function createUserList() {
    const created = listManager.createList(newListName, newListMarket);
    if (!created) {
      setSearchStatus("error");
      setMessage("リスト名を入力してください。");
      return;
    }
    setNewListName("");
    setNewListMarket("all");
    setActiveListId(created.id);
    setTargetListId(created.id);
    setMessage(`「${created.name}」を作成しました。`);
  }

  function deleteUserList(list: WatchlistList) {
    if (list.locked) return;
    const activeUserId = auth.user?.id ?? null;
    listManager.deleteList(list.id);
    setCustomItems((current) => {
      const next = current.map((item) => removeListFromItem(item, list.id));
      if (activeUserId) next.forEach((item) => {
        if (item.listIds?.length !== current.find((row) => row.stock.ticker === item.stock.ticker)?.listIds?.length) void saveDbWatchItem(activeUserId, item);
      });
      return next;
    });
    if (activeListId === list.id) setActiveListId("all");
    if (targetListId === list.id) setTargetListId(list.market === "jp" ? "jp" : "us");
    setDeleteCandidate(null);
    setMessage(`「${list.name}」を削除しました。銘柄自体は削除していません。`);
  }

  function toggleItemList(item: CustomWatchItem, listId: string, checked: boolean) {
    const nextItem = checked ? attachListToItem(item, listId) : removeListFromItem(item, listId);
    setCustomItems((current) => {
      const exists = current.some((row) => row.stock.ticker === item.stock.ticker);
      return exists
        ? current.map((row) => row.stock.ticker === item.stock.ticker ? nextItem : row)
        : [nextItem, ...current];
    });
    if (auth.user) void saveDbWatchItem(auth.user.id, nextItem);
    setMessage(`${item.stock.ticker}のリスト所属を更新しました。`);
  }

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-3xl border border-white/10 bg-slate-900/80 shadow-xl shadow-black/25 ring-1 ring-white/5">
        <div className="grid gap-0 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="min-w-0 p-5 sm:p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-300">Portfolio Monitor</p>
            <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-50">Watchlist</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="rounded-full border border-emerald-300/20 bg-emerald-300/[0.06] px-3 py-1.5 text-xs font-black text-emerald-100">{stockDataProviderPriorityLabel}</span>
              <span className="rounded-full border border-cyan-300/20 bg-cyan-300/[0.06] px-3 py-1.5 text-xs font-black text-cyan-100">
                {isSyncChecking ? "DB同期確認中" : syncMode === "supabase" ? "Supabase同期" : syncError ? "localStorage / DB失敗" : "localStorage"}
              </span>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <WatchStat label="表示銘柄" value={isSyncChecking ? "-" : `${visibleItems.length}`} tone="default" />
              <WatchStat label="米国株" value={isSyncChecking ? "-" : `${marketCounts.us}`} tone="green" />
              <WatchStat label="国内株" value={isSyncChecking ? "-" : `${marketCounts.jp}`} tone="yellow" />
            </div>
            <p className="mt-3 text-xs leading-5 text-slate-500">
              追加銘柄 {isSyncChecking ? "-" : customItems.filter((item) => !defaultTickerSet.has(item.stock.ticker)).length} / 削除済み初期銘柄 {isSyncChecking ? "-" : removedTickers.length}
            </p>
            <ListManagerPanel
              deleteCandidate={deleteCandidate}
              lists={listManager.lists}
              newListMarket={newListMarket}
              newListName={newListName}
              onCancelDelete={() => setDeleteCandidate(null)}
              onCreate={createUserList}
              onDelete={deleteUserList}
              onRequestDelete={setDeleteCandidate}
              onReset={listManager.resetLists}
              onUpdate={listManager.updateList}
              setNewListMarket={setNewListMarket}
              setNewListName={setNewListName}
            />
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
                disabled={isSyncChecking}
              />
              <button
                className="rounded-2xl bg-sky-300 px-4 py-3 text-sm font-black text-slate-950 hover:bg-sky-200 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={isSyncChecking || searchStatus === "running"}
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
                <InlineListNameEditor
                  lists={targetLists}
                  selectedListId={targetListId}
                  onChange={setTargetListId}
                />
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

      <section className="sticky top-0 z-10 -mx-2 rounded-2xl border border-white/10 bg-[#020617]/95 p-2 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
        <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-end">
        <div>
          <h3 className="text-lg font-bold text-slate-50">銘柄一覧</h3>
          <p className="mt-1 text-xs text-slate-500">市場別に絞り込みながら、現在値・判定・データソースを確認できます。</p>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0 [-webkit-overflow-scrolling:touch]">
          {listManager.lists.map((list) => (
            <MarketFilterButton
              key={list.id}
              active={activeListId === list.id}
              count={listCounts[list.id] ?? 0}
              label={list.name}
              onClick={() => setActiveListId(list.id)}
            />
          ))}
          <button
            className="rounded-full border border-sky-300/30 bg-sky-300/10 px-4 py-2 text-xs font-black text-sky-100 hover:bg-sky-300/20 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={isSyncChecking || refreshStatus === "running" || visibleItems.length === 0}
            onClick={() => void refreshAll()}
          >
            {refreshStatus === "running" ? "更新中..." : "全部リアル更新"}
          </button>
          <button
            className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-black text-slate-200 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={isSyncChecking}
            onClick={restoreDefaults}
          >
            初期銘柄を復元
          </button>
        </div>
        </div>
      </section>

      {message ? (
        <div className={searchStatus === "error" || refreshStatus === "error" ? "rounded-2xl border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-200" : "rounded-2xl border border-sky-300/25 bg-sky-300/10 p-4 text-sm text-sky-100"}>
          {message}
        </div>
      ) : null}

      {isSyncChecking ? (
        <div className="rounded-2xl border border-cyan-300/25 bg-cyan-300/10 p-5 text-sm leading-6 text-cyan-100">
          Watchlistの保存先（Supabase）を確認中です。DB同期が完了するまで銘柄操作を一時停止しています。
        </div>
      ) : null}
      {!isSyncChecking && syncError ? (
        <div className="rounded-2xl border border-yellow-300/30 bg-yellow-300/10 p-5 text-sm leading-6 text-yellow-100">
          {syncError} 現在は一時的にこの端末のlocalStorageを表示しています。
        </div>
      ) : null}
      {refreshStatus === "running" ? (
        <div className="rounded-2xl border border-sky-300/25 bg-sky-300/10 p-5 text-sm leading-6 text-sky-100">
          表示中の銘柄をリアルデータで更新しています…
        </div>
      ) : null}

      {isSyncChecking ? (
        <WatchlistSyncSkeleton />
      ) : filteredItems.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-slate-900/82 p-5 text-sm leading-6 text-slate-300 shadow-lg shadow-black/20 ring-1 ring-white/5">
          {activeListId === "all" ? "Watchlist銘柄はまだありません。" : `「${listNameById(listManager.lists, activeListId)}」の銘柄はまだありません。上の検索から追加できます。`}
        </div>
      ) : (
        <>
          <div className="space-y-3 md:hidden">
            {filteredItems.map((item) => (
              <WatchlistMobileCard
                key={item.stock.ticker}
                item={item}
                lists={listManager.lists}
                onDelete={deleteTicker}
                onToggleList={toggleItemList}
              />
            ))}
          </div>
          <div className="hidden md:block">
            <DataTable
              headers={["Ticker", "会社名", "市場", "現在値", "前日比", "スコア", "ステータス", "ソース", "メモ", "操作"]}
              rows={filteredItems.map((item) => {
                const change = item.previousClose > 0 ? ((item.currentPrice - item.previousClose) / item.previousClose) * 100 : 0;
                return [
                  <div key="ticker" className="flex flex-col gap-1">
                    <Link className="font-bold text-sky-300 hover:text-sky-200" href={`/stocks/${item.stock.ticker}`}>
                      {item.stock.ticker}
                    </Link>
                    <MarketBadge market={marketForWatchItem(item)} compact />
                  </div>,
                  item.stock.companyName,
                  <span key="exchange" className="font-semibold text-slate-300">{item.stock.exchange}</span>,
                  formatPrice(item.stock.ticker, item.currentPrice),
                  <span key="change" className={change >= 0 ? "font-semibold text-green-400" : "font-semibold text-red-400"}>{change ? `${change >= 0 ? "+" : ""}${change.toFixed(2)}%` : "-"}</span>,
                  item.score ?? "-",
                  <StatusBadge key="status" value={item.status} />,
                  item.source ?? "-",
                  item.memo,
                  <div key="actions" className="space-y-2">
                    <ListMembershipEditor item={item} lists={listManager.lists} onToggle={toggleItemList} />
                    <button
                      className="rounded-full border border-red-300/30 bg-red-400/10 px-3 py-1.5 text-xs font-black text-red-200 hover:bg-red-400/20"
                      onClick={() => deleteTicker(item.stock.ticker)}
                    >
                      削除
                    </button>
                  </div>
                ];
              })}
            />
          </div>
        </>
      )}
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

function countLists(lists: WatchlistList[], items: CustomWatchItem[]) {
  return Object.fromEntries(lists.map((list) => [list.id, filterItemsByList(items, list.id).length]));
}

function filterItemsByList(items: CustomWatchItem[], listId: string) {
  if (listId === "all") return items;
  if (listId === "us" || listId === "jp") return items.filter((item) => marketForWatchItem(item) === listId);
  return items.filter((item) => item.listIds?.includes(listId));
}

function listNameById(lists: WatchlistList[], listId: string) {
  return lists.find((list) => list.id === listId)?.name ?? "Watchlist";
}

function attachListToItem(item: CustomWatchItem, listId: string): CustomWatchItem {
  if (listId === "all" || listId === "us" || listId === "jp") return item;
  const listIds = item.listIds ?? [];
  return listIds.includes(listId) ? item : { ...item, listIds: [...listIds, listId] };
}

function removeListFromItem(item: CustomWatchItem, listId: string): CustomWatchItem {
  if (!item.listIds?.length) return item;
  const listIds = item.listIds.filter((id) => id !== listId);
  return { ...item, listIds };
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

function ListManagerPanel({
  deleteCandidate,
  lists,
  newListMarket,
  newListName,
  onCancelDelete,
  onCreate,
  onDelete,
  onRequestDelete,
  onReset,
  onUpdate,
  setNewListMarket,
  setNewListName
}: {
  deleteCandidate: WatchlistList | null;
  lists: WatchlistList[];
  newListMarket: WatchlistListMarket;
  newListName: string;
  onCancelDelete: () => void;
  onCreate: () => void;
  onDelete: (list: WatchlistList) => void;
  onRequestDelete: (list: WatchlistList) => void;
  onReset: () => void;
  onUpdate: (id: string, patch: { name?: string; market?: WatchlistListMarket }) => void;
  setNewListMarket: (market: WatchlistListMarket) => void;
  setNewListName: (name: string) => void;
}) {
  return (
    <details className="group mt-5 rounded-2xl border border-white/10 bg-slate-950/45 p-4">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
        <span className="min-w-0">
          <span className="block text-xs font-black uppercase tracking-[0.16em] text-slate-400">List Manager</span>
          <span className="mt-1 block text-xs leading-5 text-slate-500">
            {lists.length}リスト / カスタム {lists.filter((list) => !list.locked).length}件
          </span>
        </span>
        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-black text-slate-300 transition group-open:rotate-180">
          ˅
        </span>
      </summary>
      <div className="mt-4">
        <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
          <p className="text-xs leading-5 text-slate-500">リスト作成・編集・削除ができます。削除しても銘柄自体は消えません。</p>
          <button
            className="w-fit rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-black text-slate-300 hover:bg-white/10"
            onClick={onReset}
            type="button"
          >
            初期名に戻す
          </button>
        </div>
      <div className="mt-3 grid gap-2">
        {lists.map((list) => (
          <div key={list.id} className="rounded-xl border border-white/10 bg-slate-950/70 p-3">
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_150px_auto] sm:items-end">
              <ListNameInput label={list.locked ? "既定リスト名" : "リスト名"} value={list.name} onChange={(value) => onUpdate(list.id, { name: value })} />
              <label className="block rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2">
                <span className="text-[11px] font-bold text-slate-500">対象市場</span>
                <select
                  className="mt-1 w-full bg-transparent text-sm font-black text-slate-50 outline-none"
                  disabled={list.locked}
                  onChange={(event) => onUpdate(list.id, { market: event.target.value as WatchlistListMarket })}
                  value={list.market}
                >
                  <option value="all">すべて</option>
                  <option value="us">米国株</option>
                  <option value="jp">国内株</option>
                </select>
              </label>
              <button
                className="rounded-xl border border-red-300/25 bg-red-400/10 px-3 py-2 text-xs font-black text-red-200 hover:bg-red-400/20 disabled:cursor-not-allowed disabled:opacity-40"
                disabled={list.locked}
                onClick={() => onRequestDelete(list)}
                type="button"
              >
                削除
              </button>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 rounded-xl border border-sky-300/20 bg-sky-300/10 p-3">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-sky-200">Create List</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_150px_auto]">
          <input
            className="rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2 text-sm font-black text-slate-50 outline-none"
            maxLength={24}
            onChange={(event) => setNewListName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onCreate();
            }}
            placeholder="例: 量子株 / NISA候補"
            value={newListName}
          />
          <select
            className="rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2 text-sm font-black text-slate-50 outline-none"
            onChange={(event) => setNewListMarket(event.target.value as WatchlistListMarket)}
            value={newListMarket}
          >
            <option value="all">すべて</option>
            <option value="us">米国株</option>
            <option value="jp">国内株</option>
          </select>
          <button className="rounded-xl bg-sky-300 px-4 py-2 text-sm font-black text-slate-950 hover:bg-sky-200" onClick={onCreate} type="button">
            作成
          </button>
        </div>
      </div>
      {deleteCandidate ? (
        <div className="mt-3 rounded-xl border border-red-300/25 bg-red-400/10 p-3">
          <p className="text-sm font-black text-red-100">「{deleteCandidate.name}」を削除しますか？</p>
          <p className="mt-1 text-xs leading-5 text-red-100/75">この操作では銘柄自体は削除されません。リスト所属だけ解除されます。</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="rounded-full bg-red-300 px-4 py-2 text-xs font-black text-slate-950" onClick={() => onDelete(deleteCandidate)} type="button">削除する</button>
            <button className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-black text-slate-200" onClick={onCancelDelete} type="button">キャンセル</button>
          </div>
        </div>
      ) : null}
      </div>
    </details>
  );
}

function InlineListNameEditor({
  lists,
  selectedListId,
  onChange
}: {
  lists: WatchlistList[];
  selectedListId: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="mt-3 rounded-2xl border border-white/10 bg-slate-950/45 p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">追加先リスト</p>
          <p className="mt-1 text-xs leading-5 text-slate-400">検索した銘柄を入れるリストを選べます。</p>
        </div>
        <div className="min-w-0 sm:w-48">
          <select
            className="w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm font-black text-slate-50 outline-none"
            onChange={(event) => onChange(event.target.value)}
            value={selectedListId}
          >
            {lists.map((list) => <option key={list.id} value={list.id}>{list.name}</option>)}
          </select>
        </div>
      </div>
    </div>
  );
}

function ListNameInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  function commit() {
    onChange(draft);
  }

  return (
    <label className="block rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2">
      <span className="text-[11px] font-bold text-slate-500">{label}</span>
      <input
        className="mt-1 w-full bg-transparent text-sm font-black text-slate-50 outline-none placeholder:text-slate-600"
        maxLength={24}
        onBlur={commit}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
        placeholder="一覧名"
        value={draft}
      />
    </label>
  );
}

function ListMembershipEditor({
  item,
  lists,
  onToggle
}: {
  item: CustomWatchItem;
  lists: WatchlistList[];
  onToggle: (item: CustomWatchItem, listId: string, checked: boolean) => void;
}) {
  const editableLists = lists.filter((list) => !list.locked && (list.market === "all" || list.market === marketForWatchItem(item)));
  if (!editableLists.length) return <p className="text-[11px] text-slate-500">カスタムリストなし</p>;

  return (
    <div className="flex flex-wrap gap-1.5">
      {editableLists.map((list) => {
        const checked = item.listIds?.includes(list.id) ?? false;
        return (
          <label key={list.id} className={checked ? "inline-flex cursor-pointer items-center gap-1 rounded-full border border-sky-300/35 bg-sky-300/10 px-2 py-1 text-[11px] font-bold text-sky-100" : "inline-flex cursor-pointer items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] font-bold text-slate-300"}>
            <input
              checked={checked}
              className="size-3 accent-sky-300"
              onChange={(event) => onToggle(item, list.id, event.target.checked)}
              type="checkbox"
            />
            {list.name}
          </label>
        );
      })}
    </div>
  );
}

function WatchlistMobileCard({
  item,
  lists,
  onDelete,
  onToggleList
}: {
  item: CustomWatchItem;
  lists: WatchlistList[];
  onDelete: (ticker: string) => void;
  onToggleList: (item: CustomWatchItem, listId: string, checked: boolean) => void;
}) {
  const change = item.previousClose > 0 ? ((item.currentPrice - item.previousClose) / item.previousClose) * 100 : 0;
  const itemMarket = marketForWatchItem(item);

  return (
    <article className={`rounded-2xl border bg-slate-900/82 p-4 shadow-lg shadow-black/20 ring-1 ring-white/5 ${itemMarket === "jp" ? "border-amber-300/20" : "border-cyan-300/20"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link className="text-lg font-black text-sky-200" href={`/stocks/${item.stock.ticker}`}>
              {item.stock.ticker}
            </Link>
            <MarketBadge market={itemMarket} />
          </div>
          <p className="mt-1 truncate text-sm text-slate-300">{item.stock.companyName}</p>
          <p className="mt-1 text-xs text-slate-500">{item.stock.exchange} / {item.source ?? "-"}</p>
        </div>
        <StatusBadge value={item.status} />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
        <MiniMetric label="現在値" value={formatPrice(item.stock.ticker, item.currentPrice)} />
        <MiniMetric label="前日比" value={change ? `${change >= 0 ? "+" : ""}${change.toFixed(2)}%` : "-"} />
        <MiniMetric label="スコア" value={`${item.score ?? "-"}`} />
        <MiniMetric label="メモ" value={item.memo || "-"} />
      </div>
      <details className="group mt-3 rounded-xl border border-white/10 bg-slate-950/45 p-3">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
          <span className="text-[11px] font-bold text-slate-500">所属リストを編集</span>
          <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-black text-slate-300 transition group-open:rotate-180">˅</span>
        </summary>
        <div className="mt-3">
          <ListMembershipEditor item={item} lists={lists} onToggle={onToggleList} />
        </div>
      </details>
      <button
        className="mt-3 w-full rounded-2xl border border-red-300/30 bg-red-400/10 px-3 py-2 text-xs font-black text-red-200 hover:bg-red-400/20"
        onClick={() => onDelete(item.stock.ticker)}
      >
        削除
      </button>
    </article>
  );
}

function WatchlistSyncSkeleton() {
  return (
    <div className="space-y-3">
      {[0, 1, 2].map((index) => (
        <div key={index} className="rounded-2xl border border-white/10 bg-slate-900/82 p-4 shadow-lg shadow-black/20 ring-1 ring-white/5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="h-5 w-24 animate-pulse rounded bg-slate-700/70" />
              <div className="mt-3 h-3 w-44 max-w-full animate-pulse rounded bg-slate-800" />
            </div>
            <div className="h-7 w-20 animate-pulse rounded-full bg-slate-800" />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
            {[0, 1, 2, 3].map((cell) => (
              <div key={cell} className="h-14 animate-pulse rounded-xl bg-slate-950/55" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
