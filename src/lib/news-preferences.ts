import { useCallback, useEffect, useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase";

export type NewsPreferenceType = "hidden" | "seen";

export const hiddenNewsStorageKey = "d-finance-hidden-news";
export const seenNewsStorageKey = "d-finance-seen-news-notifications";

const maxStoredPreferenceKeys = 300;
export const newsPreferencesChangedEvent = "d-finance-news-preferences-changed";

export type NewsPreferenceSyncStatus = {
  configured: boolean;
  signedIn: boolean;
  synced: boolean;
  checking: boolean;
  hiddenLocalCount: number;
  seenLocalCount: number;
  hiddenRemoteCount: number | null;
  seenRemoteCount: number | null;
  lastSyncedAt: string | null;
  message: string;
};

export function storageKeyForNewsPreference(type: NewsPreferenceType) {
  return type === "hidden" ? hiddenNewsStorageKey : seenNewsStorageKey;
}

export function readNewsPreferenceKeys(type: NewsPreferenceType) {
  if (typeof window === "undefined") return new Set<string>();
  const stored = localStorage.getItem(storageKeyForNewsPreference(type));
  if (!stored) return new Set<string>();
  try {
    const parsed = JSON.parse(stored) as unknown;
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return new Set<string>();
  }
}

export function writeNewsPreferenceKeys(type: NewsPreferenceType, keys: Set<string>) {
  if (typeof window === "undefined") return;
  const limited = [...keys].slice(-maxStoredPreferenceKeys);
  localStorage.setItem(storageKeyForNewsPreference(type), JSON.stringify(limited));
  window.dispatchEvent(new CustomEvent(newsPreferencesChangedEvent, { detail: { type } }));
}

export async function addNewsPreferenceKeys(type: NewsPreferenceType, keys: Iterable<string>) {
  const localKeys = readNewsPreferenceKeys(type);
  for (const key of keys) {
    if (key) localKeys.add(key);
  }
  writeNewsPreferenceKeys(type, localKeys);
  await saveNewsPreferenceKeys(type, localKeys);
}

export async function syncNewsPreferences(types: NewsPreferenceType[] = ["hidden", "seen"]) {
  const supabase = createBrowserSupabase();
  if (!supabase) return { synced: false, reason: "Supabase is not configured." };

  const { data: userData, error: userError } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (userError || !userId) return { synced: false, reason: "User is not signed in." };

  try {
    for (const type of types) {
      const localKeys = readNewsPreferenceKeys(type);
      const remoteKeys = await loadRemoteNewsPreferenceKeys(userId, type);
      const merged = new Set([...remoteKeys, ...localKeys]);
      writeNewsPreferenceKeys(type, merged);
      await saveRemoteNewsPreferenceKeys(userId, type, merged);
    }
  } catch (error) {
    return {
      synced: false,
      reason: error instanceof Error ? error.message : "Supabase news preferences sync failed."
    };
  }

  return { synced: true };
}

export async function inspectNewsPreferencesSyncStatus(): Promise<NewsPreferenceSyncStatus> {
  const localCounts = localPreferenceCounts();
  const supabase = createBrowserSupabase();
  if (!supabase) {
    return {
      configured: false,
      signedIn: false,
      synced: false,
      checking: false,
      ...localCounts,
      hiddenRemoteCount: null,
      seenRemoteCount: null,
      lastSyncedAt: null,
      message: "Supabase環境変数が未設定です。News既読/非表示はこの端末のlocalStorageだけに保存されます。"
    };
  }

  const { data: userData, error: userError } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (userError || !userId) {
    return {
      configured: true,
      signedIn: false,
      synced: false,
      checking: false,
      ...localCounts,
      hiddenRemoteCount: null,
      seenRemoteCount: null,
      lastSyncedAt: null,
      message: "未ログインです。ログインするとNews既読/非表示をSupabaseへ同期します。"
    };
  }

  const syncResult = await syncNewsPreferences();
  let hiddenRemote = new Set<string>();
  let seenRemote = new Set<string>();
  let remoteReadError = "";
  try {
    hiddenRemote = await loadRemoteNewsPreferenceKeys(userId, "hidden");
    seenRemote = await loadRemoteNewsPreferenceKeys(userId, "seen");
  } catch (error) {
    remoteReadError = error instanceof Error ? error.message : "Supabase news preferences read failed.";
  }
  const refreshedLocalCounts = localPreferenceCounts();

  return {
    configured: true,
    signedIn: true,
    synced: syncResult.synced && !remoteReadError,
    checking: false,
    ...refreshedLocalCounts,
    hiddenRemoteCount: hiddenRemote.size,
    seenRemoteCount: seenRemote.size,
    lastSyncedAt: syncResult.synced && !remoteReadError ? new Date().toISOString() : null,
    message: syncResult.synced && !remoteReadError
      ? "News既読/非表示はSupabaseと同期されています。"
      : `News同期に失敗しました。${remoteReadError || syncResult.reason || "user_news_preferencesテーブル/RLSを確認してください。"}`
  };
}

export function useNewsPreferencesSync() {
  useEffect(() => {
    const supabase = createBrowserSupabase();
    if (!supabase) return;

    void syncNewsPreferences();
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) void syncNewsPreferences();
    });

    return () => {
      listener.subscription.unsubscribe();
    };
  }, []);
}

export function useNewsPreferencesSyncStatus() {
  const [status, setStatus] = useState<NewsPreferenceSyncStatus>(() => ({
    configured: false,
    signedIn: false,
    synced: false,
    checking: true,
    hiddenLocalCount: 0,
    seenLocalCount: 0,
    hiddenRemoteCount: null,
    seenRemoteCount: null,
    lastSyncedAt: null,
    message: "News同期状態を確認中です。"
  }));

  const refresh = useCallback(async () => {
    setStatus((current) => ({ ...current, checking: true }));
    const nextStatus = await inspectNewsPreferencesSyncStatus();
    setStatus(nextStatus);
    return nextStatus;
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { status, refresh };
}

export async function saveNewsPreferenceKeys(type: NewsPreferenceType, keys: Set<string>) {
  const supabase = createBrowserSupabase();
  if (!supabase || keys.size === 0) return;

  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return;

  try {
    await saveRemoteNewsPreferenceKeys(userId, type, keys);
  } catch {
    // localStorage remains the fallback when Supabase is unavailable or the schema is not applied.
  }
}

async function loadRemoteNewsPreferenceKeys(userId: string, type: NewsPreferenceType) {
  const supabase = createBrowserSupabase();
  if (!supabase) return new Set<string>();

  const { data, error } = await supabase
    .from("user_news_preferences")
    .select("news_key")
    .eq("user_id", userId)
    .eq("preference_type", type)
    .order("updated_at", { ascending: false })
    .limit(maxStoredPreferenceKeys);

  if (error) throw new Error(error.message);
  if (!data) return new Set<string>();
  return new Set(data.map((row) => String(row.news_key)).filter(Boolean));
}

async function saveRemoteNewsPreferenceKeys(userId: string, type: NewsPreferenceType, keys: Set<string>) {
  const supabase = createBrowserSupabase();
  if (!supabase || keys.size === 0) return;

  const rows = [...keys].slice(-maxStoredPreferenceKeys).map((key) => ({
    user_id: userId,
    preference_type: type,
    news_key: key,
    updated_at: new Date().toISOString()
  }));

  const { error } = await supabase
    .from("user_news_preferences")
    .upsert(rows, { onConflict: "user_id,preference_type,news_key" });
  if (error) throw new Error(error.message);
}

function localPreferenceCounts() {
  return {
    hiddenLocalCount: readNewsPreferenceKeys("hidden").size,
    seenLocalCount: readNewsPreferenceKeys("seen").size
  };
}
