import type { AiJobExecutionAudit, AiJobResult, AiStockExecutionAudit, NewsItem, StockAnalysisResult } from "@/types";

export function resolveAiJobAudit(result: AiJobResult | null): AiJobExecutionAudit | null {
  if (!result) return null;
  if (result.executionAudit) return result.executionAudit;

  const stockResults = result.stocks?.length
    ? result.stocks
    : [{
        stock: { ticker: "RGTI", companyName: "Rigetti Computing", sector: "Quantum Computing", exchange: "NASDAQ" },
        price: result.price,
        prices: [result.price],
        news: result.news,
        aiMarketScore: result.aiMarketScore,
        status: result.status === "Error" ? "Caution" : "Watch",
        dataFreshness: result.dataFreshness,
        report: result.report,
        error: result.error,
        warning: result.warning
      } satisfies StockAnalysisResult];

  const stocks = stockResults.map(deriveStockAudit);
  const latestNewsDate = latestDate(stocks.map((item) => item.latestNewsDate).filter((value): value is string => Boolean(value)));
  return {
    lastRun: result.lastRun,
    generatedAt: result.lastRun,
    totalStocks: stocks.length,
    completedStocks: stocks.filter((item) => item.status !== "Error").length,
    failedStocks: stocks.filter((item) => item.status === "Error").length,
    aiNewsCount: stocks.reduce((sum, item) => sum + item.aiNewsCount, 0),
    ruleNewsCount: stocks.reduce((sum, item) => sum + item.ruleNewsCount, 0),
    latestNewsDate,
    dataFreshness: result.dataFreshness,
    stocks
  };
}

export function deriveStockAudit(item: StockAnalysisResult): AiStockExecutionAudit {
  const ruleNewsCount = item.news.filter(isRuleBasedNewsAnalysis).length;
  const aiNewsCount = Math.max(item.news.length - ruleNewsCount, 0);
  return {
    ticker: item.stock.ticker,
    status: item.error ? "Error" : "Completed",
    priceSource: item.price.source || "unknown",
    priceFreshness: item.dataFreshness || item.price.date,
    newsCount: item.news.length,
    latestNewsDate: latestDate(item.news.map((newsItem) => newsItem.publishedAt)),
    aiNewsCount,
    ruleNewsCount,
    fallbackReason: deriveFallbackReason(item, ruleNewsCount),
    warning: item.warning,
    error: item.error
  };
}

export function isRuleBasedNewsAnalysis(item: NewsItem) {
  const text = `${item.aiComment} ${item.summary} ${item.risk} ${item.opportunity}`;
  return text.includes("ルールベース")
    || text.includes("OpenAIの利用上限")
    || text.includes("OpenAI API error")
    || text.includes("OpenAIのJSON解析")
    || text.includes("簡易分析")
    || text.includes("AI分析待ち");
}

function deriveFallbackReason(item: StockAnalysisResult, ruleNewsCount: number) {
  if (item.error) return item.error;
  const fallbackNews = item.news.find(isRuleBasedNewsAnalysis);
  if (fallbackNews?.aiComment.includes("利用上限") || fallbackNews?.aiComment.includes("429")) return "OpenAI 429のため、ルールベース分析に切替";
  if (fallbackNews?.aiComment.includes("OpenAI API error")) return "OpenAI APIエラーのため、ルールベース分析に切替";
  if (fallbackNews?.aiComment.includes("JSON解析")) return "OpenAI応答のJSON解析失敗のため、ルールベース分析に切替";
  if (ruleNewsCount > 0) return "一部ニュースはルールベース分析";
  return item.warning;
}

function latestDate(values: string[]) {
  const normalized = values
    .map((value) => value?.trim())
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
  return normalized.at(-1);
}
