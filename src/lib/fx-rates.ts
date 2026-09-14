import { createServerSupabase } from "@/lib/supabase";

const pair = "USDJPY";
const source = "ECB / Frankfurter (日次基準レート)";

export function parseFxRate(value: unknown, now = new Date()) {
  const data = value as { base?: unknown; quote?: unknown; date?: unknown; rate?: unknown } | null;
  if (!data || data.base !== "USD" || data.quote !== "JPY"
    || typeof data.rate !== "number" || !Number.isFinite(data.rate) || data.rate <= 0
    || typeof data.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(data.date)) {
    throw new Error("Invalid USD/JPY reference rate");
  }
  const date = new Date(`${data.date}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== data.date
    || data.date > now.toISOString().slice(0, 10)) throw new Error("Invalid USD/JPY reference date");
  return { rate: data.rate, date: data.date };
}

export async function refreshUsdJpyRate() {
  const db = createServerSupabase();
  if (!db) return { ok: false, error: "Supabase is not configured for FX storage" };
  const attemptedAt = new Date().toISOString();
  try {
    const response = await fetch("https://api.frankfurter.dev/v2/rate/USD/JPY?providers=ecb", {
      cache: "no-store", signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) throw new Error(`Frankfurter returned ${response.status}`);
    const rate = parseFxRate(await response.json());
    const { error } = await db.from("fx_daily_rates").upsert({
      pair, rate_date: rate.date, rate: rate.rate, source, fetched_at: attemptedAt
    }, { onConflict: "pair,rate_date" });
    if (error) throw new Error(error.message);
    const { error: stateError } = await db.from("fx_refresh_state").upsert({
      pair, attempted_at: attemptedAt, error: null
    });
    if (stateError) throw new Error(stateError.message);
    return { ok: true, ...rate };
  } catch (error) {
    const message = error instanceof Error ? error.message : "FX refresh failed";
    const { error: stateError } = await db.from("fx_refresh_state").upsert({
      pair, attempted_at: attemptedAt, error: message
    });
    console.error("FX daily refresh failed", message, stateError?.message ?? "");
    return { ok: false, error: message };
  }
}

export async function getUsdJpyRate() {
  const db = createServerSupabase();
  if (!db) throw new Error("Supabase is not configured for FX storage");
  const [rates, state] = await Promise.all([
    db.from("fx_daily_rates").select("rate,rate_date,source,fetched_at")
      .eq("pair", pair).order("rate_date", { ascending: false }).limit(1).maybeSingle(),
    db.from("fx_refresh_state").select("attempted_at,error").eq("pair", pair).maybeSingle()
  ]);
  if (rates.error || state.error) throw new Error("FX storage is unavailable");
  if (!rates.data) throw new Error("USD/JPY daily rate has not been collected yet");
  const data = rates.data;
  const parsed = parseFxRate({ base: "USD", quote: "JPY", rate: data.rate, date: data.rate_date });
  // Weekends and ECB holidays can leave the reference date unchanged.
  const stale = Date.now() - new Date(data.fetched_at).getTime() > 36 * 60 * 60 * 1000
    || Date.now() - new Date(`${parsed.date}T00:00:00Z`).getTime() > 7 * 86400000;
  const updateFailed = Boolean(state.data?.error);
  return {
    ok: true, pair, rate: parsed.rate, source: data.source as string,
    asOf: parsed.date, fetchedAt: data.fetched_at as string,
    lastAttemptAt: state.data?.attempted_at ?? null,
    stale, updateFailed,
    warning: updateFailed ? "更新に失敗したため、保存済みの基準レートを使用しています。"
      : stale ? "為替の更新が遅れています。保存済みの基準レートを使用しています。" : null
  };
}
