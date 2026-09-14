"use client";

import type { ReactNode } from "react";
import { FxRateProvider } from "@/components/FxRateDisplay";
import { NewsFeedProvider } from "@/lib/news-feed-context";
import { WatchlistProvider } from "@/lib/watchlist-context";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <WatchlistProvider>
      <NewsFeedProvider><FxRateProvider>{children}</FxRateProvider></NewsFeedProvider>
    </WatchlistProvider>
  );
}
