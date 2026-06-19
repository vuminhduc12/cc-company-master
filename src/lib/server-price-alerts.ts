import { createServerSupabase } from "@/lib/supabase";

export type ServerAlertCondition = "above" | "below";
export type ServerAlertMetric = "price" | "rsi" | "volume_ratio";

export type ServerPriceAlert = {
  id: string;
  ticker: string;
  metric: ServerAlertMetric;
  condition: ServerAlertCondition;
  value: number;
  label: string;
  active: boolean;
  triggered: boolean;
  createdAt: string;
  triggeredAt?: string;
};

type AlertTarget = {
  price?: number;
  rsi?: number;
  volumeRatio?: number;
};

type UserAlertsRow = {
  user_id: string;
  alerts: unknown;
};

export async function loadServerAlertTickers() {
  const supabase = createServerSupabase();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("user_alerts")
    .select("alerts");
  if (error || !data) return [];

  const tickers = new Set<string>();
  for (const row of data as { alerts: unknown }[]) {
    for (const alert of parseAlerts(row.alerts)) {
      if (alert.active && !alert.triggered) tickers.add(alert.ticker.toUpperCase());
    }
  }
  return Array.from(tickers);
}

export async function checkServerAlertsForTicker(ticker: string, target: AlertTarget) {
  const supabase = createServerSupabase();
  if (!supabase) return { triggered: 0 };

  const normalizedTicker = ticker.toUpperCase();
  const { data, error } = await supabase
    .from("user_alerts")
    .select("user_id, alerts");
  if (error || !data) return { triggered: 0, error: error?.message };

  let triggered = 0;
  const triggeredAt = new Date().toISOString();

  for (const row of data as UserAlertsRow[]) {
    const alerts = parseAlerts(row.alerts);
    let changed = false;
    const updated = alerts.map((alert) => {
      if (!shouldTriggerAlert(alert, normalizedTicker, target)) return alert;
      changed = true;
      triggered++;
      return {
        ...alert,
        triggered: true,
        active: false,
        triggeredAt
      };
    });

    if (changed) {
      const { error: updateError } = await supabase
        .from("user_alerts")
        .update({ alerts: updated, updated_at: triggeredAt })
        .eq("user_id", row.user_id);
      if (updateError) return { triggered, error: updateError.message };
    }
  }

  return { triggered };
}

function shouldTriggerAlert(alert: ServerPriceAlert, ticker: string, target: AlertTarget) {
  if (!alert.active || alert.triggered || alert.ticker.toUpperCase() !== ticker) return false;
  const current =
    alert.metric === "price" ? target.price
    : alert.metric === "rsi" ? target.rsi
    : alert.metric === "volume_ratio" ? target.volumeRatio
    : undefined;
  if (current === undefined || current === null || !Number.isFinite(current)) return false;
  return alert.condition === "above" ? current >= alert.value : current <= alert.value;
}

function parseAlerts(value: unknown): ServerPriceAlert[] {
  return Array.isArray(value) ? value.filter(isAlert) : [];
}

function isAlert(value: unknown): value is ServerPriceAlert {
  if (!value || typeof value !== "object") return false;
  const alert = value as Partial<ServerPriceAlert>;
  return Boolean(
    typeof alert.id === "string"
    && typeof alert.ticker === "string"
    && typeof alert.value === "number"
    && (alert.metric === "price" || alert.metric === "rsi" || alert.metric === "volume_ratio")
    && (alert.condition === "above" || alert.condition === "below")
  );
}
