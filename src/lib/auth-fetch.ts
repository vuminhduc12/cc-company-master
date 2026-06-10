"use client";

import { createBrowserSupabase } from "@/lib/supabase";

export async function authHeaders(): Promise<Record<string, string>> {
  const supabase = createBrowserSupabase();
  if (!supabase) return {};
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}
