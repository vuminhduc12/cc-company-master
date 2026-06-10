"use client";

import { useEffect, useState } from "react";
import { loadLatestJobResult } from "@/lib/supabase";
import type { AiJobResult, NewsItem } from "@/types";

const storageKey = "d-finance-ai-job-result";
const hiddenNewsStorageKey = "d-finance-hidden-news";

export function useAiJobResult() {
  const [jobResult, setJobResult] = useState<AiJobResult | null>(null);

  useEffect(() => {
    let mounted = true;
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as AiJobResult;
        if (isUsableStoredResult(parsed)) {
          setJobResult(filterHiddenNews(parsed));
        } else {
          localStorage.removeItem(storageKey);
        }
      } catch {
        localStorage.removeItem(storageKey);
        setJobResult(null);
      }
    }
    loadLatestJobResult().then((result) => {
      if (!mounted || !result) return;
      const visibleResult = filterHiddenNews(result);
      localStorage.setItem(storageKey, JSON.stringify(visibleResult));
      setJobResult(visibleResult);
    });
    return () => {
      mounted = false;
    };
  }, []);

  return jobResult;
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

  const stored = localStorage.getItem(storageKey);
  if (!stored) return;
  try {
    const result = filterHiddenNews(JSON.parse(stored) as AiJobResult, keys);
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
      news: stock.news.filter((item) => !hiddenKeys.has(newsIdentity(item)))
    }))
  };
}

function readHiddenNewsKeys() {
  if (typeof window === "undefined") return new Set<string>();
  const stored = localStorage.getItem(hiddenNewsStorageKey);
  if (!stored) return new Set<string>();
  try {
    const parsed = JSON.parse(stored) as unknown;
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return new Set<string>();
  }
}

export { hiddenNewsStorageKey, storageKey };
