export type WatchStatus = "Strong Buy" | "Buy" | "Watch" | "Caution" | "Sell";
export type Sentiment = "Positive" | "Negative" | "Neutral";
export type TaskStatus = "Pending" | "Running" | "Completed" | "Error";

export type Stock = {
  ticker: string;
  companyName: string;
  sector: string;
  exchange: string;
};

export type WatchlistItem = {
  stock: Stock;
  shares: number;
  averagePrice: number;
  currentPrice: number;
  previousClose: number;
  status: WatchStatus;
  memo: string;
};

export type DailyPrice = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  changePercent: number;
  volumeAverage20: number;
  volumeRatio: number;
  intradayRangePercent: number;
  rsi: number;
  macd: number;
  macdSignal: number;
  macdHistogram: number;
  macdDirection: "上昇" | "低下";
  rsiSignal: string;
  high20Breakout: string;
  ma5: number;
  ma20: number;
  ma50: number;
  volumeAverage: number;
  closeAfter5Days: number | null;
  changeAfter5Days: number | null;
  closeAfter10Days: number | null;
  changeAfter10Days: number | null;
  score: number;
  pattern: string;
  comment: string;
  source: string;
};

export type NewsItem = {
  title: string;
  url?: string;
  source: string;
  publishedAt: string;
  ticker: string;
  summary: string;
  sentiment: Sentiment;
  impactScore: number;
  risk: string;
  opportunity: string;
  aiComment: string;
};

export type ScoreFactor = {
  label: string;
  points: number;
  detail: string;
  tone: "positive" | "negative" | "neutral";
};

export type StockScoreAnalysis = {
  score: number;
  status: WatchStatus;
  factors: ScoreFactor[];
  positivePoints: ScoreFactor[];
  negativePoints: ScoreFactor[];
  summary: string;
};

export type AiTask = {
  name: string;
  role: string;
  task: string;
  status: TaskStatus;
  lastRun: string;
  result: string;
  error?: string;
  nextRun?: string;
};

export type DailyReport = {
  date: string;
  market: string;
  watchlist: string;
  news: string;
  decision: string;
  tomorrow: string;
};

export type StockAnalysisResult = {
  stock: Stock;
  price: DailyPrice;
  prices: DailyPrice[];
  news: NewsItem[];
  aiMarketScore: number;
  status: WatchStatus;
  dataFreshness: string;
  report: DailyReport;
  error?: string;
  warning?: string;
};

export type AiJobResult = {
  ok: boolean;
  mode: "live" | "mock";
  status: TaskStatus;
  lastRun: string;
  nextRun: string;
  dataFreshness: string;
  aiMarketScore: number;
  price: DailyPrice;
  news: NewsItem[];
  stocks?: StockAnalysisResult[];
  tasks: AiTask[];
  report: DailyReport;
  error?: string;
  warning?: string;
};
