import type { Stock, WatchlistItem } from "@/types";
import type { WatchlistList } from "@/lib/watchlist-storage";

export type MarketScope = "all" | "us" | "jp";
export type StockMarket = Exclude<MarketScope, "all">;

type MarketAwareItem = WatchlistItem & {
  market?: StockMarket;
  listIds?: string[];
};

export function marketForTicker(ticker: string): StockMarket {
  return /^\d{4}(\.T|\.JP)?$/i.test(ticker) ? "jp" : "us";
}

export function marketForStock(stock: Stock): StockMarket {
  return stock.exchange === "TSE" || marketForTicker(stock.ticker) === "jp" ? "jp" : "us";
}

export function marketForWatchItem(item: MarketAwareItem): StockMarket {
  return item.market === "jp" || marketForStock(item.stock) === "jp" ? "jp" : "us";
}

export function countWatchlistMarkets(items: MarketAwareItem[]) {
  return {
    all: items.length,
    us: items.filter((item) => marketForWatchItem(item) === "us").length,
    jp: items.filter((item) => marketForWatchItem(item) === "jp").length
  };
}

export function filterItemsByWatchlistList<T extends MarketAwareItem>(items: T[], listId: string) {
  if (listId === "all") return items;
  if (listId === "us" || listId === "jp") return items.filter((item) => marketForWatchItem(item) === listId);
  return items.filter((item) => item.listIds?.includes(listId));
}

export function countWatchlistLists(lists: WatchlistList[], items: MarketAwareItem[]) {
  return Object.fromEntries(lists.map((list) => [list.id, filterItemsByWatchlistList(items, list.id).length]));
}

export function marketLabel(market: StockMarket) {
  return market === "jp" ? "国内株" : "米国株";
}

export function MarketBadge({ market, compact = false, variant = "dark" }: { market: StockMarket; compact?: boolean; variant?: "dark" | "light" }) {
  return (
    <span className={`w-fit rounded-full border px-2 py-0.5 text-[10px] font-black ${marketBadgeClass(market, variant)}`}>
      {compact ? (market === "jp" ? "JP" : "US") : marketLabel(market)}
    </span>
  );
}

export function MarketFilterButton({
  active,
  count,
  label,
  onClick,
  variant = "dark"
}: {
  active: boolean;
  count: number;
  label: string;
  onClick: () => void;
  variant?: "dark" | "light";
}) {
  const inactiveClass = variant === "light"
    ? "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
    : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10";
  const activeClass = variant === "light"
    ? "border-blue-300 bg-blue-50 text-blue-900 shadow-sm"
    : "border-sky-300/45 bg-sky-300/20 text-sky-50 shadow-lg shadow-sky-950/20";

  return (
    <button
      className={`rounded-full border px-4 py-2 text-xs font-black ${active ? activeClass : inactiveClass}`}
      onClick={onClick}
      type="button"
    >
      {label} <span className={active && variant === "light" ? "ml-1 text-blue-700/70" : "ml-1 text-slate-400"}>{count}</span>
    </button>
  );
}

function marketBadgeClass(market: StockMarket, variant: "dark" | "light") {
  if (variant === "light") {
    return market === "jp"
      ? "border-amber-300 bg-amber-50 text-amber-800"
      : "border-cyan-300 bg-cyan-50 text-cyan-800";
  }
  return market === "jp"
    ? "border-amber-300/35 bg-amber-300/10 text-amber-100"
    : "border-cyan-300/35 bg-cyan-300/10 text-cyan-100";
}
