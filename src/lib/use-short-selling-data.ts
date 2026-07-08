"use client";

import { useEffect, useState } from "react";
import type { ShortSellingFetchResult } from "@/lib/short-selling-data";

export function useShortSellingData(ticker: string, enabled: boolean) {
  const [data, setData] = useState<ShortSellingFetchResult | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!enabled) {
      setData(null);
      setStatus("idle");
      setError("");
      return;
    }

    let cancelled = false;

    async function load() {
      setStatus("loading");
      setError("");
      try {
        const response = await fetch(`/api/stocks/${encodeURIComponent(ticker)}/short-selling`, { cache: "no-store" });
        const payload = await response.json() as ShortSellingFetchResult | { ok: false; error?: string };
        if (cancelled) return;
        if (!response.ok || !payload.ok) {
          throw new Error("error" in payload ? payload.error ?? "空売り残高報告を取得できませんでした。" : "空売り残高報告を取得できませんでした。");
        }
        setData(payload);
        setStatus("done");
      } catch (loadError) {
        if (!cancelled) {
          setData(null);
          setStatus("error");
          setError(loadError instanceof Error ? loadError.message : "空売り残高報告を取得できませんでした。");
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [enabled, ticker]);

  return { data, status, error };
}
