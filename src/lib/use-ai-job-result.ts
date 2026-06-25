"use client";

import { useEffect, useState } from "react";
import { hiddenNewsStorageKey, readNewsPreferenceKeys, addNewsPreferenceKeys } from "@/lib/news-preferences";
import { loadLatestJobResult } from "@/lib/supabase";
import type { AiJobResult, NewsItem } from "@/types";

const storageKey = "d-finance-ai-job-result";
const aiJobResultChangedEvent = "d-finance-ai-job-result-changed";

export function useAiJobResult() {
  const [jobResult, setJobResult] = useState<AiJobResult | null>(null);

  useEffect(() => {
    let mounted = true;

    function applyResult(result: AiJobResult | null) {
      if (!mounted || !result) return;
      try {
        const visibleResult = filterHiddenNews(normalizeAiJobResult(result));
        localStorage.setItem(storageKey, JSON.stringify(visibleResult));
        setJobResult(visibleResult);
      } catch {
        localStorage.removeItem(storageKey);
        setJobResult(null);
      }
    }

    const stored = localStorage.getItem(storageKey);
    if (stored) {
      try {
        const parsed = normalizeAiJobResult(JSON.parse(stored) as AiJobResult);
        if (isUsableStoredResult(parsed)) {
          applyResult(parsed);
        } else {
          localStorage.removeItem(storageKey);
        }
      } catch {
        localStorage.removeItem(storageKey);
        setJobResult(null);
      }
    }

    loadLatestJobResult()
      .then((result) => applyResult(result ? normalizeAiJobResult(result) : null))
      .catch(() => {
        if (mounted) setJobResult(null);
      });

    function handleStoredResultChange() {
      const current = localStorage.getItem(storageKey);
      if (!current) {
        if (mounted) setJobResult(null);
        return;
      }
      try {
        applyResult(JSON.parse(current) as AiJobResult);
      } catch {
        localStorage.removeItem(storageKey);
        if (mounted) setJobResult(null);
      }
    }

    window.addEventListener(aiJobResultChangedEvent, handleStoredResultChange);
    window.addEventListener("storage", handleStoredResultChange);

    return () => {
      mounted = false;
      window.removeEventListener(aiJobResultChangedEvent, handleStoredResultChange);
      window.removeEventListener("storage", handleStoredResultChange);
    };
  }, []);

  return jobResult;
}

function normalizeAiJobResult(result: AiJobResult): AiJobResult {
  return {
    ...result,
    news: Array.isArray(result.news) ? result.news : [],
    tasks: Array.isArray(result.tasks) ? result.tasks : [],
    stocks: Array.isArray(result.stocks)
      ? result.stocks.map((stock) => ({
        ...stock,
        news: Array.isArray(stock.news) ? stock.news : [],
        prices: Array.isArray(stock.prices) ? stock.prices : stock.price ? [stock.price] : []
      }))
      : result.stocks
  };
}

function isUsableStoredResult(result: AiJobResult) {
  return Boolean(
    result
    && result.status !== "Error"
    && Array.isArray(result.news)
    && Array.isArray(result.tasks)
    && result.price
    && result.report
  );
}

export function newsIdentity(item: NewsItem) {
  return `${item.ticker}|${item.publishedAt}|${item.source}|${item.url ?? item.title}`;
}

export function hideNewsItem(item: NewsItem) {
  const keys = readHiddenNewsKeys();
  keys.add(newsIdentity(item));
  localStorage.setItem(hiddenNewsStorageKey, JSON.stringify([...keys]));
  void addNewsPreferenceKeys("hidden", [newsIdentity(item)]);

  const stored = localStorage.getItem(storageKey);
  if (!stored) return;
  try {
    const result = filterHiddenNews(normalizeAiJobResult(JSON.parse(stored) as AiJobResult), keys);
    localStorage.setItem(storageKey, JSON.stringify(result));
  } catch {
    localStorage.removeItem(storageKey);
  }
}

function filterHiddenNews(result: AiJobResult, hiddenKeys = readHiddenNewsKeys()) {
  if (hiddenKeys.size === 0) return result;
  return {
    ...result,
    news: result.news.filter((item) => !hiddenKeys.has(newsIdentity(item))),
    stocks: result.stocks?.map((stock) => ({
      ...stock,
      news: (stock.news ?? []).filter((item) => !hiddenKeys.has(newsIdentity(item)))
    }))
  };
}

function readHiddenNewsKeys() {
  return readNewsPreferenceKeys("hidden");
}

export { aiJobResultChangedEvent, hiddenNewsStorageKey, storageKey };
