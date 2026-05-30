"use client";

import { useEffect, useState } from "react";
import { loadLatestJobResult } from "@/lib/supabase";
import type { AiJobResult } from "@/types";

const storageKey = "d-finance-ai-job-result";

export function useAiJobResult() {
  const [jobResult, setJobResult] = useState<AiJobResult | null>(null);

  useEffect(() => {
    let mounted = true;
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      try {
        setJobResult(JSON.parse(stored) as AiJobResult);
      } catch {
        setJobResult(null);
      }
    }
    loadLatestJobResult().then((result) => {
      if (!mounted || !result) return;
      localStorage.setItem(storageKey, JSON.stringify(result));
      setJobResult(result);
    });
    return () => {
      mounted = false;
    };
  }, []);

  return jobResult;
}

export { storageKey };
