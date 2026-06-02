import type { NewsItem } from "@/types";

export const freshNewsWindowDays = 3;

export function isFreshNews(item: Pick<NewsItem, "publishedAt">, maxAgeDays = freshNewsWindowDays) {
  const age = newsAgeDays(item.publishedAt);
  return Number.isFinite(age) && age <= maxAgeDays && age >= -1;
}

export function filterFreshNews<T extends Pick<NewsItem, "publishedAt">>(items: T[], maxAgeDays = freshNewsWindowDays) {
  return items.filter((item) => isFreshNews(item, maxAgeDays));
}

export function countStaleNews<T extends Pick<NewsItem, "publishedAt">>(items: T[], maxAgeDays = freshNewsWindowDays) {
  return items.length - filterFreshNews(items, maxAgeDays).length;
}

function newsAgeDays(value: string) {
  const normalized = normalizeNewsDate(value);
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return Number.NaN;
  return (Date.now() - date.getTime()) / 86400000;
}

function normalizeNewsDate(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T00:00:00Z`;
  return value;
}
