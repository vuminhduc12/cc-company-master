export function isJapaneseStockTicker(ticker: string) {
  return /^\d{4}(\.T|\.JP)?$/i.test(ticker) || /^\d{5}$/.test(ticker);
}

export function toJQuantsStockCode(ticker: string) {
  return ticker.trim().replace(/\.T$/i, "").replace(/\.JP$/i, "");
}
