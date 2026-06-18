import { useEffect } from "react";
import { createBrowserSupabase } from "@/lib/supabase";

export type NewsPreferenceType = "hidden" | "seen";

export const hiddenNewsStorageKey = "d-finance-hidden-news";
export const seenNewsStorageKey = "d-finance-seen-news-notifications";

const maxStoredPreferenceKeys = 300;
export const newsPreferencesChangedEvent = "d-finance-news-preferences-changed";

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

  for (const type of types) {
    const localKeys = readNewsPreferenceKeys(type);
    const remoteKeys = await loadRemoteNewsPreferenceKeys(userId, type);
    const merged = new Set([...remoteKeys, ...localKeys]);
    writeNewsPreferenceKeys(type, merged);
    await saveRemoteNewsPreferenceKeys(userId, type, merged);
  }

  return { synced: true };
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

export async function saveNewsPreferenceKeys(type: NewsPreferenceType, keys: Set<string>) {
  const supabase = createBrowserSupabase();
  if (!supabase || keys.size === 0) return;

  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return;

  await saveRemoteNewsPreferenceKeys(userId, type, keys);
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

  if (error || !data) return new Set<string>();
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

  await supabase
    .from("user_news_preferences")
    .upsert(rows, { onConflict: "user_id,preference_type,news_key" });
}
