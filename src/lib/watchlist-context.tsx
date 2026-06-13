"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  applyWatchlistRefresh,
  mergeRefreshedCustomItems,
  mergeVisibleWatchItems,
  needsRealtimeRefresh,
  refreshWatchlistBatch,
  type WatchlistRefreshResult
} from "@/lib/watchlist-refresh";
import { buildTickerHistoryEntry, type TickerHistoryEntry } from "@/lib/stock-history-cache";
import { createBrowserSupabase } from "@/lib/supabase";
import { useAiJobResult } from "@/lib/use-ai-job-result";
import {
  customWatchlistStorageKey,
  loadCustomWatchItems,
  loadDbWatchlistState,
  loadRemovedWatchTickers,
  migrateLocalWatchlistToDb,
  removedWatchlistStorageKey,
  saveDbWatchItems,
  type CustomWatchItem
} from "@/lib/watchlist-storage";
type RefreshStatus = "idle" | "running" | "error";
const watchlistSyncTimeoutMs = 8000;

type WatchlistContextValue = {
  items: CustomWatchItem[];
  customItems: CustomWatchItem[];
  removedTickers: string[];
  ready: boolean;
  syncMode: "checking" | "local" | "supabase";
  syncError: string;
  refreshStatus: RefreshStatus;
  refreshMessage: string;
  historyRevision: number;
  getTickerHistory: (ticker: string) => TickerHistoryEntry | null;
  setCustomItems: React.Dispatch<React.SetStateAction<CustomWatchItem[]>>;
  setRemovedTickers: React.Dispatch<React.SetStateAction<string[]>>;
  refreshAll: () => Promise<void>;
};

const defaultWatchlistContext: WatchlistContextValue = {
  items: [],
  customItems: [],
  removedTickers: [],
  ready: false,
  syncMode: "checking",
  syncError: "",
  refreshStatus: "idle",
  refreshMessage: "",
  historyRevision: 0,
  getTickerHistory: () => null,
  setCustomItems: () => undefined,
  setRemovedTickers: () => undefined,
  refreshAll: async () => undefined
};

const WatchlistContext = createContext<WatchlistContextValue>(defaultWatchlistContext);

export function WatchlistProvider({ children }: { children: ReactNode }) {
  const jobResult = useAiJobResult();
  const [customItems, setCustomItems] = useState<CustomWatchItem[]>([]);
  const [removedTickers, setRemovedTickers] = useState<string[]>([]);
  const [syncMode, setSyncMode] = useState<"checking" | "local" | "supabase">("checking");
  const [syncError, setSyncError] = useState("");
  const [ready, setReady] = useState(false);
  const [refreshStatus, setRefreshStatus] = useState<RefreshStatus>("idle");
  const [refreshMessage, setRefreshMessage] = useState("");
  const [historyByTicker, setHistoryByTicker] = useState<Record<string, TickerHistoryEntry>>({});
  const [historyRevision, setHistoryRevision] = useState(0);
  const [userId, setUserId] = useState<string | null>(null);
  const autoRefreshStarted = useRef(false);
  const syncRequestId = useRef(0);

  const visibleItems = useMemo(
    () => mergeVisibleWatchItems(customItems, removedTickers, jobResult),
    [customItems, removedTickers, jobResult]
  );

  const items = useMemo(
    () => ready ? visibleItems : [],
    [ready, visibleItems]
  );

  useEffect(() => {
    const supabase = createBrowserSupabase();
    if (!supabase) {
      setCustomItems(loadCustomWatchItems());
      setRemovedTickers(loadRemovedWatchTickers());
      setSyncMode("local");
      setSyncError("");
      setReady(true);
      setUserId(null);
      return;
    }

    let cancelled = false;

    function applyLocalFallback(message = "") {
      setCustomItems(loadCustomWatchItems());
      setRemovedTickers(loadRemovedWatchTickers());
      setSyncMode("local");
      setSyncError(message);
      setReady(true);
    }

    async function loadForUser() {
      if (!supabase) return;
      const requestId = ++syncRequestId.current;
      applyLocalFallback("");
      try {
        const { data } = await withTimeout(supabase.auth.getUser(), watchlistSyncTimeoutMs, "ログイン状態の確認がタイムアウトしました。");
        if (cancelled || requestId !== syncRequestId.current) return;
        const activeUserId = data.user?.id ?? null;
        if (!cancelled) setUserId(activeUserId);

        if (!activeUserId) {
          if (!cancelled) applyLocalFallback("");
          return;
        }

        if (cancelled) return;
        setSyncMode("checking");
        setSyncError("");
        const localCustomItems = loadCustomWatchItems();
        const localRemovedTickers = loadRemovedWatchTickers();
        const dbState = await withTimeout(loadDbWatchlistState(activeUserId), watchlistSyncTimeoutMs, "Watchlist DB同期がタイムアウトしました。");
        if (cancelled || requestId !== syncRequestId.current) return;

        if (!dbState) {
          setCustomItems(localCustomItems);
          setRemovedTickers(localRemovedTickers);
          setSyncMode("local");
          setSyncError("Supabase未設定のため、この端末のlocalStorageを使用しています。");
          setReady(true);
          return;
        }

        if (dbState.customItems.length === 0 && dbState.removedTickers.length === 0 && (localCustomItems.length || localRemovedTickers.length)) {
          await withTimeout(migrateLocalWatchlistToDb(activeUserId, localCustomItems, localRemovedTickers), watchlistSyncTimeoutMs, "ローカルWatchlistのDB移行がタイムアウトしました。");
          if (cancelled || requestId !== syncRequestId.current) return;
          setCustomItems(localCustomItems);
          setRemovedTickers(localRemovedTickers);
          setSyncMode("supabase");
          setSyncError("");
          setReady(true);
          return;
        }

        setCustomItems(dbState.customItems);
        setRemovedTickers(dbState.removedTickers);
        setSyncMode("supabase");
        setSyncError("");
        setReady(true);
      } catch (error) {
        if (cancelled || requestId !== syncRequestId.current) return;
        applyLocalFallback(error instanceof Error ? `Supabase DB同期に失敗しました: ${error.message}` : "Supabase DB同期に失敗しました。");
      }
    }

    void loadForUser();

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return;
      const requestId = ++syncRequestId.current;
      const activeUserId = session?.user?.id ?? null;
      setUserId(activeUserId);

      if (!activeUserId) {
        applyLocalFallback("");
        autoRefreshStarted.current = false;
        return;
      }

      void (async () => {
        setSyncMode("checking");
        setSyncError("");
        autoRefreshStarted.current = false;
        const localCustomItems = loadCustomWatchItems();
        const localRemovedTickers = loadRemovedWatchTickers();
        try {
          const dbState = await withTimeout(loadDbWatchlistState(activeUserId), watchlistSyncTimeoutMs, "Watchlist DB同期がタイムアウトしました。");
          if (cancelled || requestId !== syncRequestId.current) return;

          if (!dbState) {
            setCustomItems(localCustomItems);
            setRemovedTickers(localRemovedTickers);
            setSyncMode("local");
            setSyncError("Supabase未設定のため、この端末のlocalStorageを使用しています。");
            setReady(true);
            return;
          }

          if (dbState.customItems.length === 0 && dbState.removedTickers.length === 0 && (localCustomItems.length || localRemovedTickers.length)) {
            await withTimeout(migrateLocalWatchlistToDb(activeUserId, localCustomItems, localRemovedTickers), watchlistSyncTimeoutMs, "ローカルWatchlistのDB移行がタイムアウトしました。");
            if (cancelled || requestId !== syncRequestId.current) return;
            setCustomItems(localCustomItems);
            setRemovedTickers(localRemovedTickers);
            setSyncMode("supabase");
            setSyncError("");
            setReady(true);
            return;
          }

          setCustomItems(dbState.customItems);
          setRemovedTickers(dbState.removedTickers);
          setSyncMode("supabase");
          setSyncError("");
          setReady(true);
        } catch (error) {
          if (cancelled || requestId !== syncRequestId.current) return;
          applyLocalFallback(error instanceof Error ? `Supabase DB同期に失敗しました: ${error.message}` : "Supabase DB同期に失敗しました。");
        }
      })();
    });

    return () => {
      cancelled = true;
      listener?.subscription?.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!ready || syncMode !== "local") return;
    saveLocalCustomWatchItems(customItems);
  }, [customItems, ready, syncMode]);

  useEffect(() => {
    if (!ready || syncMode !== "local") return;
    try {
      localStorage.setItem(removedWatchlistStorageKey, JSON.stringify(removedTickers));
    } catch (error) {
      console.warn("Failed to save removed watchlist tickers.", error);
    }
  }, [removedTickers, ready, syncMode]);

  const applyRefreshResults = useCallback((targets: CustomWatchItem[], results: WatchlistRefreshResult[]) => {
    const resultMap = new Map<string, WatchlistRefreshResult>();
    results.forEach((row) => resultMap.set(row.ticker, row));

    const refreshed = targets.flatMap((item) => {
      const result = resultMap.get(item.stock.ticker);
      if (!result || result.ok === false) return [];
      return [applyWatchlistRefresh(item, result)];
    });

    if (refreshed.length === 0) {
      return { successCount: 0, failureCount: results.length };
    }

    setCustomItems((current) => mergeRefreshedCustomItems(current, refreshed));

    const nextHistory: Record<string, TickerHistoryEntry> = {};
    results.forEach((row) => {
      if (row.ok === false) return;
      const entry = buildTickerHistoryEntry(row);
      if (entry) nextHistory[entry.stock.ticker] = entry;
    });
    if (Object.keys(nextHistory).length > 0) {
      setHistoryByTicker((current) => ({ ...current, ...nextHistory }));
      setHistoryRevision((current) => current + 1);
    }

    if (userId) {
      void saveDbWatchItems(userId, refreshed.map(stripPriceHistory));
    }

    return {
      successCount: refreshed.length,
      failureCount: results.length - refreshed.length
    };
  }, [userId]);

  const refreshItems = useCallback(async (targets: CustomWatchItem[], mode: "auto" | "manual") => {
    if (targets.length === 0) return { successCount: 0, failureCount: 0 };
    setRefreshStatus("running");
    if (mode === "manual") setRefreshMessage("");

    try {
      const payload = await refreshWatchlistBatch(targets.map((item) => ({
        ticker: item.stock.ticker,
        market: item.market
      })));
      const { successCount, failureCount } = applyRefreshResults(targets, payload.results);
      setRefreshStatus(failureCount > 0 && successCount === 0 ? "error" : "idle");

      if (mode === "manual") {
        setRefreshMessage(failureCount > 0
          ? `${successCount}銘柄をリアルデータで更新しました。${failureCount}銘柄は失敗しました。`
          : `${successCount}銘柄をリアルデータで更新しました。`);
      } else if (successCount > 0) {
        setRefreshMessage(`${successCount}銘柄をリアルデータで自動更新しました。`);
      }

      return { successCount, failureCount };
    } catch (error) {
      setRefreshStatus("error");
      if (mode === "manual") {
        setRefreshMessage(error instanceof Error ? error.message : "更新に失敗しました。");
      }
      return { successCount: 0, failureCount: targets.length };
    }
  }, [applyRefreshResults]);

  const refreshAll = useCallback(async () => {
    await refreshItems(visibleItems, "manual");
  }, [refreshItems, visibleItems]);

  useEffect(() => {
    if (syncMode === "checking" || !ready || autoRefreshStarted.current || visibleItems.length === 0) return;
    autoRefreshStarted.current = true;
    const staleItems = visibleItems.filter(needsRealtimeRefresh);
    if (staleItems.length === 0) return;
    void refreshItems(staleItems, "auto");
  }, [syncMode, ready, visibleItems, refreshItems]);

  useEffect(() => {
    if (!ready) return;
    const timer = window.setInterval(() => {
      const staleItems = mergeVisibleWatchItems(customItems, removedTickers, jobResult).filter(needsRealtimeRefresh);
      if (staleItems.length > 0) void refreshItems(staleItems, "auto");
    }, 15 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [ready, customItems, removedTickers, jobResult, refreshItems]);

  const getTickerHistory = useCallback((ticker: string) => historyByTicker[ticker] ?? null, [historyByTicker]);

  const value = useMemo<WatchlistContextValue>(() => ({
    items,
    customItems,
    removedTickers,
    ready,
    syncMode,
    syncError,
    refreshStatus,
    refreshMessage,
    historyRevision,
    getTickerHistory,
    setCustomItems,
    setRemovedTickers,
    refreshAll
  }), [items, customItems, removedTickers, ready, syncMode, syncError, refreshStatus, refreshMessage, historyRevision, getTickerHistory, refreshAll]);

  return <WatchlistContext.Provider value={value}>{children}</WatchlistContext.Provider>;
}

export function useUserWatchlist() {
  return useContext(WatchlistContext);
}

function stripPriceHistory({ priceHistory, ...persisted }: CustomWatchItem): CustomWatchItem {
  void priceHistory;
  return persisted;
}

function saveLocalCustomWatchItems(items: CustomWatchItem[]) {
  try {
    localStorage.setItem(customWatchlistStorageKey, JSON.stringify(items.map(stripPriceHistory)));
    return;
  } catch (error) {
    if (!isQuotaExceededError(error)) {
      console.warn("Failed to save custom watchlist.", error);
      return;
    }
  }

  try {
    localStorage.setItem(customWatchlistStorageKey, JSON.stringify(items.map(toMinimalPersistedWatchItem)));
  } catch (error) {
    console.warn("Failed to save compact custom watchlist.", error);
  }
}

function toMinimalPersistedWatchItem(item: CustomWatchItem): CustomWatchItem {
  return {
    stock: item.stock,
    shares: item.shares,
    averagePrice: item.averagePrice,
    currentPrice: item.currentPrice,
    previousClose: item.previousClose,
    status: item.status,
    memo: item.memo,
    market: item.market,
    listIds: item.listIds,
    score: item.score,
    source: item.source,
    fetchedAt: item.fetchedAt,
    latestPrice: item.latestPrice
  };
}

function isQuotaExceededError(error: unknown) {
  return error instanceof DOMException && (
    error.name === "QuotaExceededError"
    || error.name === "NS_ERROR_DOM_QUOTA_REACHED"
    || error.code === 22
    || error.code === 1014
  );
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), timeoutMs);
    promise
      .then(resolve)
      .catch(reject)
      .finally(() => window.clearTimeout(timer));
  });
}
