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
} from "@/lib/user-watchlist";
type RefreshStatus = "idle" | "running" | "error";

type WatchlistContextValue = {
  items: CustomWatchItem[];
  customItems: CustomWatchItem[];
  removedTickers: string[];
  ready: boolean;
  syncMode: "checking" | "local" | "supabase";
  refreshStatus: RefreshStatus;
  refreshMessage: string;
  setCustomItems: React.Dispatch<React.SetStateAction<CustomWatchItem[]>>;
  setRemovedTickers: React.Dispatch<React.SetStateAction<string[]>>;
  refreshAll: () => Promise<void>;
};

const WatchlistContext = createContext<WatchlistContextValue | null>(null);

export function WatchlistProvider({ children }: { children: ReactNode }) {
  const jobResult = useAiJobResult();
  const [customItems, setCustomItems] = useState<CustomWatchItem[]>([]);
  const [removedTickers, setRemovedTickers] = useState<string[]>([]);
  const [syncMode, setSyncMode] = useState<"checking" | "local" | "supabase">("checking");
  const [ready, setReady] = useState(false);
  const [refreshStatus, setRefreshStatus] = useState<RefreshStatus>("idle");
  const [refreshMessage, setRefreshMessage] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const autoRefreshStarted = useRef(false);

  const visibleItems = useMemo(
    () => mergeVisibleWatchItems(customItems, removedTickers, jobResult),
    [customItems, removedTickers, jobResult]
  );

  const items = visibleItems;

  useEffect(() => {
    const supabase = createBrowserSupabase();
    if (!supabase) {
      setCustomItems(loadCustomWatchItems());
      setRemovedTickers(loadRemovedWatchTickers());
      setSyncMode("local");
      setReady(true);
      setUserId(null);
      return;
    }

    let cancelled = false;

    async function loadForUser() {
      if (!supabase) return;
      const { data } = await supabase.auth.getUser();
      const activeUserId = data.user?.id ?? null;
      if (!cancelled) setUserId(activeUserId);

      if (!activeUserId) {
        if (!cancelled) {
          setCustomItems(loadCustomWatchItems());
          setRemovedTickers(loadRemovedWatchTickers());
          setSyncMode("local");
          setReady(true);
        }
        return;
      }

      if (cancelled) return;
      setSyncMode("checking");
      const localCustomItems = loadCustomWatchItems();
      const localRemovedTickers = loadRemovedWatchTickers();
      const dbState = await loadDbWatchlistState(activeUserId);
      if (cancelled) return;

      if (!dbState) {
        setCustomItems(localCustomItems);
        setRemovedTickers(localRemovedTickers);
        setSyncMode("local");
        setReady(true);
        return;
      }

      if (dbState.customItems.length === 0 && dbState.removedTickers.length === 0 && (localCustomItems.length || localRemovedTickers.length)) {
        await migrateLocalWatchlistToDb(activeUserId, localCustomItems, localRemovedTickers);
        if (cancelled) return;
        setCustomItems(localCustomItems);
        setRemovedTickers(localRemovedTickers);
        setSyncMode("supabase");
        setReady(true);
        return;
      }

      setCustomItems(dbState.customItems);
      setRemovedTickers(dbState.removedTickers);
      setSyncMode("supabase");
      setReady(true);
    }

    void loadForUser();

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return;
      const activeUserId = session?.user?.id ?? null;
      setUserId(activeUserId);

      if (!activeUserId) {
        setSyncMode("local");
        setCustomItems(loadCustomWatchItems());
        setRemovedTickers(loadRemovedWatchTickers());
        setReady(true);
        autoRefreshStarted.current = false;
        return;
      }

      void (async () => {
        setReady(false);
        setSyncMode("checking");
        autoRefreshStarted.current = false;
        const localCustomItems = loadCustomWatchItems();
        const localRemovedTickers = loadRemovedWatchTickers();
        const dbState = await loadDbWatchlistState(activeUserId);
        if (cancelled) return;

        if (!dbState) {
          setCustomItems(localCustomItems);
          setRemovedTickers(localRemovedTickers);
          setSyncMode("local");
          setReady(true);
          return;
        }

        if (dbState.customItems.length === 0 && dbState.removedTickers.length === 0 && (localCustomItems.length || localRemovedTickers.length)) {
          await migrateLocalWatchlistToDb(activeUserId, localCustomItems, localRemovedTickers);
          if (cancelled) return;
          setCustomItems(localCustomItems);
          setRemovedTickers(localRemovedTickers);
          setSyncMode("supabase");
          setReady(true);
          return;
        }

        setCustomItems(dbState.customItems);
        setRemovedTickers(dbState.removedTickers);
        setSyncMode("supabase");
        setReady(true);
      })();
    });

    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!ready || syncMode !== "local") return;
    localStorage.setItem(customWatchlistStorageKey, JSON.stringify(customItems));
  }, [customItems, ready, syncMode]);

  useEffect(() => {
    if (!ready || syncMode !== "local") return;
    localStorage.setItem(removedWatchlistStorageKey, JSON.stringify(removedTickers));
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
    if (userId) void saveDbWatchItems(userId, refreshed);

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

  const value = useMemo<WatchlistContextValue>(() => ({
    items,
    customItems,
    removedTickers,
    ready,
    syncMode,
    refreshStatus,
    refreshMessage,
    setCustomItems,
    setRemovedTickers,
    refreshAll
  }), [items, customItems, removedTickers, ready, syncMode, refreshStatus, refreshMessage, refreshAll]);

  return <WatchlistContext.Provider value={value}>{children}</WatchlistContext.Provider>;
}

export function useUserWatchlist() {
  const context = useContext(WatchlistContext);
  if (!context) {
    throw new Error("useUserWatchlist must be used within WatchlistProvider");
  }
  return context;
}
