import type { NewsItem } from "@/types";

/** Shared identity for dedupe / hide keys. Safe for server and client. */
export function newsIdentity(item: NewsItem) {
  return `${item.ticker}|${item.publishedAt}|${item.source}|${item.url ?? item.title}`;
}
