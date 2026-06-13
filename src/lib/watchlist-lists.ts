"use client";

import { useEffect, useMemo, useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase";
import {
  defaultWatchlistLists,
  loadDbWatchlistLists,
  loadWatchlistLists,
  normalizeListName,
  normalizeWatchlistLists,
  saveDbWatchlistLists,
  saveWatchlistLists,
  type WatchlistList,
  type WatchlistListMarket
} from "@/lib/watchlist-storage";

export type WatchlistListLabels = Record<"all" | "us" | "jp", string>;

export function useWatchlistLists() {
  const [lists, setLists] = useState<WatchlistList[]>(defaultWatchlistLists);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const localLists = loadWatchlistLists();
    setLists(localLists);

    const supabase = createBrowserSupabase();
    if (!supabase) return;

    async function loadRemoteLists() {
      if (!supabase) return;
      try {
        const { data } = await supabase.auth.getUser();
        const activeUserId = data.user?.id ?? null;
        if (cancelled) return;
        setUserId(activeUserId);
        if (!activeUserId) return;
        const remoteLists = await loadDbWatchlistLists(activeUserId);
        if (cancelled || !remoteLists) return;
        setLists(remoteLists);
        saveWatchlistLists(remoteLists);
      } catch {
        if (!cancelled) setLists(localLists);
      }
    }

    void loadRemoteLists();
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      const activeUserId = session?.user?.id ?? null;
      setUserId(activeUserId);
      if (!activeUserId) {
        const next = loadWatchlistLists();
        setLists(next);
        return;
      }
      void loadDbWatchlistLists(activeUserId).then((remoteLists) => {
        if (!remoteLists) return;
        setLists(remoteLists);
        saveWatchlistLists(remoteLists);
      }).catch(() => undefined);
    });

    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, []);

  const labels = useMemo<WatchlistListLabels>(() => ({
    all: lists.find((list) => list.id === "all")?.name ?? defaultWatchlistLists[0].name,
    us: lists.find((list) => list.id === "us")?.name ?? defaultWatchlistLists[1].name,
    jp: lists.find((list) => list.id === "jp")?.name ?? defaultWatchlistLists[2].name
  }), [lists]);

  function persist(next: WatchlistList[]) {
    const normalized = normalizeWatchlistLists(next);
    setLists(normalized);
    saveWatchlistLists(normalized);
    if (userId) void saveDbWatchlistLists(userId, normalized);
  }

  function createList(name: string, market: WatchlistListMarket = "all") {
    const normalizedName = normalizeListName(name);
    if (!normalizedName) return null;
    const now = new Date().toISOString();
    const list: WatchlistList = {
      id: `list-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      name: normalizedName,
      market,
      createdAt: now,
      updatedAt: now
    };
    persist([...lists, list]);
    return list;
  }

  function updateList(id: string, patch: { name?: string; market?: WatchlistListMarket }) {
    const now = new Date().toISOString();
    persist(lists.map((list) => {
      if (list.id !== id) return list;
      const defaultList = defaultWatchlistLists.find((row) => row.id === list.id);
      return {
        ...list,
        name: patch.name !== undefined ? normalizeListName(patch.name) || list.name : list.name,
        market: defaultList?.market ?? patch.market ?? list.market,
        locked: defaultList?.locked ?? list.locked,
        updatedAt: now
      };
    }));
  }

  function deleteList(id: string) {
    const target = lists.find((list) => list.id === id);
    if (!target || target.locked) return;
    persist(lists.filter((list) => list.id !== id));
  }

  function resetLists() {
    persist(defaultWatchlistLists);
  }

  return {
    labels,
    lists,
    createList,
    updateList,
    deleteList,
    resetLists
  };
}
