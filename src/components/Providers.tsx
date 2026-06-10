"use client";

import type { ReactNode } from "react";
import { WatchlistProvider } from "@/lib/watchlist-context";

export function Providers({ children }: { children: ReactNode }) {
  return <WatchlistProvider>{children}</WatchlistProvider>;
}
