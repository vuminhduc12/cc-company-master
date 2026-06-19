"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  addAlert,
  checkAlerts,
  conditionLabel,
  deleteAlert,
  loadAlerts,
  markAlertTriggered,
  metricLabel,
  requestNotificationPermission,
  resetAlert,
  saveAlerts,
  sendBrowserNotification,
  type AlertCondition,
  type AlertMetric,
  type PriceAlert,
} from "@/lib/price-alerts";

type Props = {
  ticker: string;
  currentPrice?: number;
  currentRsi?: number;
  currentVolumeRatio?: number;
};

export function PriceAlertPanel({ ticker, currentPrice, currentRsi, currentVolumeRatio }: Props) {
  const [alerts, setAlerts] = useState<PriceAlert[]>([]);
  const [metric, setMetric] = useState<AlertMetric>("price");
  const [condition, setCondition] = useState<AlertCondition>("above");
  const [value, setValue] = useState("");
  const [notifStatus, setNotifStatus] = useState<"unknown" | "granted" | "denied">("unknown");
  const checkedRef = useRef<Set<string>>(new Set());

  // 初期ロード
  useEffect(() => {
    setAlerts(loadAlerts().filter((a) => a.ticker === ticker));
    if ("Notification" in window) {
      setNotifStatus(
        Notification.permission === "granted" ? "granted"
        : Notification.permission === "denied" ? "denied"
        : "unknown"
      );
    }
  }, [ticker]);

  // アラートチェック（価格更新のたびに実行）
  useEffect(() => {
    const triggered = checkAlerts(ticker, {
      price: currentPrice,
      rsi: currentRsi,
      volumeRatio: currentVolumeRatio,
    });
    if (triggered.length === 0) return;

    for (const alert of triggered) {
      if (checkedRef.current.has(alert.id)) continue;
      checkedRef.current.add(alert.id);
      const current =
        alert.metric === "price" ? currentPrice
        : alert.metric === "rsi" ? currentRsi
        : currentVolumeRatio;
      if (current !== undefined) sendBrowserNotification(alert, current);
      const updated = markAlertTriggered(alert.id);
      setAlerts(updated.filter((a) => a.ticker === ticker));
    }
  }, [ticker, currentPrice, currentRsi, currentVolumeRatio]);

  const refresh = useCallback(() => {
    setAlerts(loadAlerts().filter((a) => a.ticker === ticker));
  }, [ticker]);

  function handleAdd() {
    const numVal = parseFloat(value);
    if (!Number.isFinite(numVal) || numVal <= 0) return;

    const condStr = condition === "above" ? "以上" : "以下";
    const label = `${ticker} ${metricLabel(metric)} ${numVal} ${condStr}`;
    addAlert({ ticker, metric, condition, value: numVal, label });
    setValue("");
    refresh();
  }

  async function handleEnableNotif() {
    const ok = await requestNotificationPermission();
    setNotifStatus(ok ? "granted" : "denied");
  }

  const tickerAlerts = alerts.filter((a) => a.ticker === ticker);
  const activeCount = tickerAlerts.filter((a) => a.active && !a.triggered).length;
  const triggeredCount = tickerAlerts.filter((a) => a.triggered).length;

  const defaultValue =
    metric === "price" ? currentPrice?.toFixed(2) ?? ""
    : metric === "rsi" ? currentRsi?.toFixed(0) ?? ""
    : currentVolumeRatio?.toFixed(1) ?? "";

  return (
    <section className="rounded-2xl border border-amber-300/20 bg-slate-900/80 p-5 shadow-xl shadow-black/20 ring-1 ring-white/5">
      {/* ヘッダー */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-300">Price Alert</p>
          <h3 className="mt-2 text-lg font-semibold text-slate-50">
            アラート設定
            {activeCount > 0 && (
              <span className="ml-2 rounded-full bg-amber-400/20 px-2 py-0.5 text-xs font-black text-amber-200">
                {activeCount}件 有効
              </span>
            )}
            {triggeredCount > 0 && (
              <span className="ml-2 rounded-full bg-red-400/20 px-2 py-0.5 text-xs font-black text-red-200">
                {triggeredCount}件 発動済み
              </span>
            )}
          </h3>
        </div>
        {notifStatus !== "granted" && (
          <button
            className="shrink-0 rounded-xl border border-amber-300/30 bg-amber-300/10 px-3 py-1.5 text-xs font-black text-amber-100 hover:bg-amber-300/20"
            onClick={() => void handleEnableNotif()}
          >
            🔔 通知を有効化
          </button>
        )}
        {notifStatus === "granted" && (
          <span className="shrink-0 rounded-full border border-emerald-300/30 bg-emerald-300/10 px-2 py-1 text-xs font-black text-emerald-200">
            🔔 通知ON
          </span>
        )}
        {notifStatus === "denied" && (
          <span className="shrink-0 rounded-full border border-red-300/30 bg-red-400/10 px-2 py-1 text-xs font-black text-red-200">
            通知ブロック中
          </span>
        )}
      </div>

      {/* 追加フォーム */}
      <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
        <select
          className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-slate-50 outline-none focus:border-amber-300/50"
          value={metric}
          onChange={(e) => {
            setMetric(e.target.value as AlertMetric);
            setValue("");
          }}
        >
          <option value="price">価格 ($)</option>
          <option value="rsi">RSI</option>
          <option value="volume_ratio">出来高倍率 (x)</option>
        </select>

        <select
          className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-slate-50 outline-none focus:border-amber-300/50"
          value={condition}
          onChange={(e) => setCondition(e.target.value as AlertCondition)}
        >
          <option value="above">以上になったら</option>
          <option value="below">以下になったら</option>
        </select>

        <div className="relative">
          <input
            className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-slate-50 outline-none focus:border-amber-300/50"
            placeholder={defaultValue || "数値"}
            type="number"
            step="any"
            min="0"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
          />
        </div>

        <button
          className="rounded-xl bg-amber-400 px-4 py-2 text-sm font-black text-slate-950 hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!value || isNaN(parseFloat(value))}
          onClick={handleAdd}
        >
          追加
        </button>
      </div>

      {/* 現在値ヒント */}
      {(currentPrice !== undefined || currentRsi !== undefined) && (
        <p className="mt-2 text-xs text-slate-500">
          現在値 →{" "}
          {currentPrice !== undefined && <span className="mr-3">価格 ${currentPrice.toFixed(2)}</span>}
          {currentRsi !== undefined && <span className="mr-3">RSI {currentRsi.toFixed(1)}</span>}
          {currentVolumeRatio !== undefined && <span>出来高倍率 {currentVolumeRatio.toFixed(2)}x</span>}
        </p>
      )}

      {/* アラートリスト */}
      {tickerAlerts.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {tickerAlerts.map((alert) => (
            <AlertRow
              key={alert.id}
              alert={alert}
              onDelete={() => {
                deleteAlert(alert.id);
                refresh();
              }}
              onReset={() => {
                resetAlert(alert.id);
                checkedRef.current.delete(alert.id);
                refresh();
              }}
            />
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-slate-500">アラートはまだありません。条件を設定して追加してください。</p>
      )}
    </section>
  );
}

function AlertRow({
  alert,
  onDelete,
  onReset,
}: {
  alert: PriceAlert;
  onDelete: () => void;
  onReset: () => void;
}) {
  const triggered = alert.triggered;
  const borderColor = triggered ? "border-red-300/25" : "border-white/8";
  const bgColor = triggered ? "bg-red-400/8" : "bg-slate-950/40";

  return (
    <li className={`flex items-center justify-between gap-3 rounded-xl border ${borderColor} ${bgColor} px-3 py-2.5`}>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-slate-100">{alert.label}</p>
        {triggered && alert.triggeredAt && (
          <p className="mt-0.5 text-xs text-red-300">
            🔔 発動: {alert.triggeredAt.slice(0, 16).replace("T", " ")}
          </p>
        )}
        {!triggered && (
          <p className="mt-0.5 text-xs text-slate-500">
            {metricLabel(alert.metric)} {conditionLabel(alert.condition)} {alert.value}
          </p>
        )}
      </div>
      <div className="flex shrink-0 gap-1.5">
        {triggered && (
          <button
            className="rounded-lg border border-amber-300/25 bg-amber-300/10 px-2.5 py-1 text-xs font-black text-amber-100 hover:bg-amber-300/20"
            onClick={onReset}
          >
            リセット
          </button>
        )}
        <button
          className="rounded-lg border border-red-300/20 bg-red-400/10 px-2.5 py-1 text-xs font-black text-red-200 hover:bg-red-400/20"
          onClick={onDelete}
        >
          削除
        </button>
      </div>
    </li>
  );
}
