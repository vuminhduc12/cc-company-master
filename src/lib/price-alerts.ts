"use client";

import { createBrowserSupabase } from "@/lib/supabase";

export type AlertCondition = "above" | "below";
export type AlertMetric = "price" | "rsi" | "volume_ratio";

export type PriceAlert = {
  id: string;
  ticker: string;
  metric: AlertMetric;
  condition: AlertCondition;
  value: number;
  label: string;
  active: boolean;
  triggered: boolean;
  createdAt: string;
  triggeredAt?: string;
};

const STORAGE_KEY = "dfinance.priceAlerts.v1";

// ---------- local storage ----------

export function loadAlerts(): PriceAlert[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isAlert) : [];
  } catch {
    return [];
  }
}

export function saveAlerts(alerts: PriceAlert[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(alerts));
  } catch {
    // ignore
  }
}

export function addAlert(alert: Omit<PriceAlert, "id" | "active" | "triggered" | "createdAt">): PriceAlert {
  const newAlert: PriceAlert = {
    ...alert,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    active: true,
    triggered: false,
    createdAt: new Date().toISOString(),
  };
  const existing = loadAlerts();
  saveAlerts([...existing, newAlert]);
  return newAlert;
}

export function deleteAlert(id: string) {
  const alerts = loadAlerts().filter((a) => a.id !== id);
  saveAlerts(alerts);
}

export function resetAlert(id: string) {
  const alerts = loadAlerts().map((a) =>
    a.id === id ? { ...a, triggered: false, triggeredAt: undefined, active: true } : a
  );
  saveAlerts(alerts);
}

export function markAlertTriggered(id: string): PriceAlert[] {
  const alerts = loadAlerts().map((a) =>
    a.id === id ? { ...a, triggered: true, triggeredAt: new Date().toISOString() } : a
  );
  saveAlerts(alerts);
  return alerts;
}

// ---------- check logic ----------

type CheckTarget = {
  price?: number;
  rsi?: number;
  volumeRatio?: number;
};

export function checkAlerts(ticker: string, target: CheckTarget): PriceAlert[] {
  const alerts = loadAlerts();
  const triggered: PriceAlert[] = [];

  for (const alert of alerts) {
    if (!alert.active || alert.triggered || alert.ticker !== ticker) continue;

    const current =
      alert.metric === "price" ? target.price
      : alert.metric === "rsi" ? target.rsi
      : alert.metric === "volume_ratio" ? target.volumeRatio
      : undefined;

    if (current === undefined || current === null) continue;

    const hit =
      alert.condition === "above" ? current >= alert.value
      : current <= alert.value;

    if (hit) triggered.push(alert);
  }

  return triggered;
}

// ---------- browser notification ----------

export async function requestNotificationPermission(): Promise<boolean> {
  if (typeof window === "undefined" || !("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const result = await Notification.requestPermission();
  return result === "granted";
}

export function sendBrowserNotification(alert: PriceAlert, currentValue: number) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;

  const metricLabel =
    alert.metric === "price" ? "価格"
    : alert.metric === "rsi" ? "RSI"
    : "出来高倍率";

  const conditionLabel = alert.condition === "above" ? "以上" : "以下";
  const valueStr =
    alert.metric === "price" ? `$${currentValue.toFixed(2)}`
    : alert.metric === "rsi" ? currentValue.toFixed(1)
    : `${currentValue.toFixed(2)}x`;

  new Notification(`🔔 ${alert.ticker} アラート発動`, {
    body: `${metricLabel}が${alert.value}${conditionLabel}になりました（現在: ${valueStr}）`,
    icon: "/favicon.ico",
    tag: alert.id,
  });
}

// ---------- Supabase sync (optional) ----------

export async function syncAlertsToDb(userId: string, alerts: PriceAlert[]) {
  const supabase = createBrowserSupabase();
  if (!supabase) return;
  try {
    await supabase.from("user_alerts").upsert(
      { user_id: userId, alerts, updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    );
  } catch {
    // optional — silently fail
  }
}

export async function loadAlertsFromDb(userId: string): Promise<PriceAlert[] | null> {
  const supabase = createBrowserSupabase();
  if (!supabase) return null;
  try {
    const { data } = await supabase
      .from("user_alerts")
      .select("alerts")
      .eq("user_id", userId)
      .maybeSingle();
    const arr = (data as { alerts?: unknown } | null)?.alerts;
    return Array.isArray(arr) ? arr.filter(isAlert) : null;
  } catch {
    return null;
  }
}

// ---------- helpers ----------

function isAlert(value: unknown): value is PriceAlert {
  if (!value || typeof value !== "object") return false;
  const a = value as Partial<PriceAlert>;
  return (
    typeof a.id === "string" &&
    typeof a.ticker === "string" &&
    typeof a.value === "number" &&
    (a.metric === "price" || a.metric === "rsi" || a.metric === "volume_ratio") &&
    (a.condition === "above" || a.condition === "below")
  );
}

export function metricLabel(metric: AlertMetric) {
  return metric === "price" ? "価格 ($)" : metric === "rsi" ? "RSI" : "出来高倍率 (x)";
}

export function conditionLabel(condition: AlertCondition) {
  return condition === "above" ? "以上になったら" : "以下になったら";
}
