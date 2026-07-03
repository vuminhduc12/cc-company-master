export const aiDiagnosisHistoryStorageKey = "d-finance-ai-diagnosis-history";
const maxHistoryPerTicker = 30;

export type AiDiagnosisRuntime = {
  mode: "ai" | "rule";
  model?: string;
  warning?: string;
  cached?: boolean;
};

export type AiDiagnosisHistoryComment = {
  summary: string;
  dataFreshness?: string;
  riskLevel: "低" | "中" | "高";
  confidence?: "低" | "中" | "高";
  irView?: string;
  balanceSheetView?: string;
  incomeStatementView?: string;
  businessValueView?: string;
  marketView?: {
    scenario: "upside" | "range" | "downside";
    confidence: "低" | "中" | "高";
    topEvidence: string[];
  };
  historicalPatternView?: string;
  newsImpactView?: string;
  macroImpactView?: string;
  largeMoneyFlowView?: string;
  scenarioForecast?: {
    oneToTwoWeeks: string;
    oneToThreeMonths: string;
    upsideTrigger: string;
    downsideInvalidation: string;
    dangerLevel: string;
  };
  riskFilter?: string;
  analystView?: string;
  scenarioPrediction?: string;
  userQuestionAnswer?: string;
};

export type AiDiagnosisHistoryInput = {
  shares: number;
  entryPrice: number;
  takeProfitPercent: number;
  stopLossPercent: number;
  accountType: string;
  feeJpy: number;
  fxRate: number;
  currency: "USD" | "JPY";
};

export type AiDiagnosisHistoryItem = {
  id: string;
  ticker: string;
  companyName: string;
  createdAt: string;
  diagnosisMode: "normal" | "detailed";
  question?: string;
  runtime: AiDiagnosisRuntime;
  comment: AiDiagnosisHistoryComment;
  input: AiDiagnosisHistoryInput;
  quote: {
    price: number;
    date: string;
    changePercent: number;
  };
};

export function loadAiDiagnosisHistory(ticker: string) {
  const all = loadAllAiDiagnosisHistory();
  return all.filter((item) => item.ticker === ticker).slice(0, maxHistoryPerTicker);
}

export function saveAiDiagnosisHistory(item: AiDiagnosisHistoryItem) {
  const all = loadAllAiDiagnosisHistory();
  const withoutSameId = all.filter((current) => current.id !== item.id);
  const next = [item, ...withoutSameId]
    .filter((current, index, array) => {
      if (current.ticker !== item.ticker) return true;
      return array.filter((row) => row.ticker === item.ticker).indexOf(current) < maxHistoryPerTicker;
    })
    .slice(0, 300);
  localStorage.setItem(aiDiagnosisHistoryStorageKey, JSON.stringify(next));
  return next.filter((current) => current.ticker === item.ticker);
}

export function deleteAiDiagnosisHistoryItem(id: string, ticker: string) {
  const next = loadAllAiDiagnosisHistory().filter((item) => item.id !== id);
  localStorage.setItem(aiDiagnosisHistoryStorageKey, JSON.stringify(next));
  return next.filter((item) => item.ticker === ticker).slice(0, maxHistoryPerTicker);
}

export function clearAiDiagnosisHistoryForTicker(ticker: string) {
  const next = loadAllAiDiagnosisHistory().filter((item) => item.ticker !== ticker);
  localStorage.setItem(aiDiagnosisHistoryStorageKey, JSON.stringify(next));
  return [];
}

function loadAllAiDiagnosisHistory() {
  if (typeof window === "undefined") return [];
  const stored = localStorage.getItem(aiDiagnosisHistoryStorageKey);
  if (!stored) return [];
  try {
    const parsed = JSON.parse(stored) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isHistoryItem).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    localStorage.removeItem(aiDiagnosisHistoryStorageKey);
    return [];
  }
}

function isHistoryItem(value: unknown): value is AiDiagnosisHistoryItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<AiDiagnosisHistoryItem>;
  return typeof item.id === "string"
    && typeof item.ticker === "string"
    && typeof item.createdAt === "string"
    && (item.diagnosisMode === "normal" || item.diagnosisMode === "detailed")
    && Boolean(item.comment)
    && Boolean(item.runtime)
    && Boolean(item.input)
    && Boolean(item.quote);
}
