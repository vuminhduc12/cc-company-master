import { randomUUID } from "crypto";

export type AiUsageFeature = "daily_news_analysis" | "spot_diagnosis" | "spot_question";
export type AiUsageStatus = "success" | "cache_hit" | "fallback" | "limit_exceeded" | "error";

export type AiUsageLog = {
  id: string;
  userId: string;
  feature: AiUsageFeature;
  ticker?: string;
  model?: string;
  promptVersion?: string;
  status: AiUsageStatus;
  errorCode?: string;
  errorMessage?: string;
  usedCache: boolean;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  createdAt: string;
};

export type AiUsageSummary = {
  userId: string;
  monthlyLimit: number;
  monthStart: string;
  totalCalls: number;
  billableCalls: number;
  remainingCalls: number;
  cacheHits: number;
  fallbackCount: number;
  limitExceededCount: number;
  rateLimitCount: number;
  errorCount: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  lastRateLimitAt?: string;
  recent: AiUsageLog[];
};

type ChatCompletionUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
};

type OpenAiChatResult<T> = {
  ok: boolean;
  status: number;
  payload?: T;
  warning?: string;
  errorCode?: string;
  errorMessage?: string;
};

const usageLogs: AiUsageLog[] = [];
const maxLogs = 1000;
const defaultUserId = "local-user";
const defaultMonthlyLimit = 200;

export function getAiUserId() {
  return defaultUserId;
}

export function recordAiUsage(input: Omit<AiUsageLog, "id" | "userId" | "createdAt" | "estimatedCostUsd"> & {
  userId?: string;
  createdAt?: string;
  estimatedCostUsd?: number;
}) {
  const log: AiUsageLog = {
    id: randomUUID(),
    userId: input.userId ?? defaultUserId,
    feature: input.feature,
    ticker: input.ticker,
    model: input.model,
    promptVersion: input.promptVersion,
    status: input.status,
    errorCode: input.errorCode,
    errorMessage: input.errorMessage,
    usedCache: input.usedCache,
    inputTokens: Math.max(0, Math.round(input.inputTokens || 0)),
    outputTokens: Math.max(0, Math.round(input.outputTokens || 0)),
    estimatedCostUsd: input.estimatedCostUsd ?? estimateOpenAiCost(input.model, input.inputTokens || 0, input.outputTokens || 0),
    createdAt: input.createdAt ?? new Date().toISOString()
  };
  usageLogs.unshift(log);
  if (usageLogs.length > maxLogs) usageLogs.length = maxLogs;
  return log;
}

export function recordAiCacheHit(input: {
  feature: AiUsageFeature;
  ticker?: string;
  model?: string;
  promptVersion?: string;
}) {
  return recordAiUsage({
    ...input,
    status: "cache_hit",
    usedCache: true,
    inputTokens: 0,
    outputTokens: 0
  });
}

export async function callOpenAiChatWithUsageGuard<T>(input: {
  feature: AiUsageFeature;
  ticker?: string;
  model: string;
  promptVersion?: string;
  estimatedInputTokens?: number;
  body: Record<string, unknown>;
  apiKey?: string;
}): Promise<OpenAiChatResult<T>> {
  const allowed = canUseAi(input.feature);
  if (!allowed.allowed) {
    recordAiUsage({
      feature: input.feature,
      ticker: input.ticker,
      model: input.model,
      promptVersion: input.promptVersion,
      status: "limit_exceeded",
      errorCode: "LOCAL_LIMIT",
      errorMessage: allowed.reason,
      usedCache: false,
      inputTokens: 0,
      outputTokens: 0
    });
    return {
      ok: false,
      status: 429,
      errorCode: "LOCAL_LIMIT",
      errorMessage: allowed.reason,
      warning: "AI利用上限に達したため、ルールベース分析に切り替えました。"
    };
  }

  if (!input.apiKey) {
    recordAiUsage({
      feature: input.feature,
      ticker: input.ticker,
      model: input.model,
      promptVersion: input.promptVersion,
      status: "fallback",
      errorCode: "NO_OPENAI_API_KEY",
      errorMessage: "OPENAI_API_KEY is not configured.",
      usedCache: false,
      inputTokens: 0,
      outputTokens: 0
    });
    return {
      ok: false,
      status: 401,
      errorCode: "NO_OPENAI_API_KEY",
      errorMessage: "OPENAI_API_KEY is not configured.",
      warning: "OPENAI_API_KEY未設定のため、ルールベース分析に切り替えました。"
    };
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${input.apiKey}`
    },
    body: JSON.stringify(input.body)
  });

  let payload: (T & { usage?: ChatCompletionUsage; error?: { message?: string; type?: string; code?: string } }) | undefined;
  try {
    payload = await response.json();
  } catch {
    payload = undefined;
  }

  const inputTokens = payload?.usage?.prompt_tokens ?? input.estimatedInputTokens ?? estimateTokens(input.body);
  const outputTokens = payload?.usage?.completion_tokens ?? 0;
  if (!response.ok) {
    const isRateLimited = response.status === 429;
    const errorCode = String(payload?.error?.code ?? response.status);
    const errorMessage = payload?.error?.message ?? `OpenAI API returned ${response.status}`;
    recordAiUsage({
      feature: input.feature,
      ticker: input.ticker,
      model: input.model,
      promptVersion: input.promptVersion,
      status: isRateLimited ? "fallback" : "error",
      errorCode: isRateLimited ? "429" : errorCode,
      errorMessage,
      usedCache: false,
      inputTokens,
      outputTokens
    });
    return {
      ok: false,
      status: response.status,
      payload,
      errorCode: isRateLimited ? "429" : errorCode,
      errorMessage,
      warning: isRateLimited
        ? "OpenAI 429のため、ルールベース分析に切り替えました。"
        : `OpenAI API error ${response.status}のため、ルールベース分析に切り替えました。`
    };
  }

  recordAiUsage({
    feature: input.feature,
    ticker: input.ticker,
    model: input.model,
    promptVersion: input.promptVersion,
    status: "success",
    usedCache: false,
    inputTokens,
    outputTokens
  });
  return { ok: true, status: response.status, payload };
}

export function getAiUsageSummary(userId = defaultUserId): AiUsageSummary {
  const monthStart = startOfMonthIso();
  const monthlyLogs = usageLogs.filter((log) => log.userId === userId && log.createdAt >= monthStart);
  const monthlyLimit = getMonthlyLimit();
  const billableCalls = monthlyLogs.filter((log) => log.status === "success").length;
  const rateLimitLogs = monthlyLogs.filter((log) => log.errorCode === "429");
  return {
    userId,
    monthlyLimit,
    monthStart,
    totalCalls: monthlyLogs.length,
    billableCalls,
    remainingCalls: Math.max(0, monthlyLimit - billableCalls),
    cacheHits: monthlyLogs.filter((log) => log.status === "cache_hit").length,
    fallbackCount: monthlyLogs.filter((log) => log.status === "fallback").length,
    limitExceededCount: monthlyLogs.filter((log) => log.status === "limit_exceeded").length,
    rateLimitCount: rateLimitLogs.length,
    errorCount: monthlyLogs.filter((log) => log.status === "error").length,
    inputTokens: monthlyLogs.reduce((sum, log) => sum + log.inputTokens, 0),
    outputTokens: monthlyLogs.reduce((sum, log) => sum + log.outputTokens, 0),
    estimatedCostUsd: Number(monthlyLogs.reduce((sum, log) => sum + log.estimatedCostUsd, 0).toFixed(6)),
    lastRateLimitAt: rateLimitLogs[0]?.createdAt,
    recent: monthlyLogs.slice(0, 20)
  };
}

function canUseAi(feature: AiUsageFeature) {
  const summary = getAiUsageSummary();
  const monthlyLimit = getMonthlyLimit();
  if (summary.billableCalls >= monthlyLimit) {
    return { allowed: false, reason: `月間AI利用上限 ${monthlyLimit} 回に達しています。` };
  }
  const dailyLimit = getDailyLimit(feature);
  const today = new Date().toISOString().slice(0, 10);
  const todaySuccess = usageLogs.filter((log) => log.createdAt.startsWith(today) && log.status === "success" && log.feature === feature).length;
  if (todaySuccess >= dailyLimit) {
    return { allowed: false, reason: `本日の${feature}利用上限 ${dailyLimit} 回に達しています。` };
  }
  return { allowed: true };
}

function getMonthlyLimit() {
  return parsePositiveInt(process.env.AI_MONTHLY_CALL_LIMIT, defaultMonthlyLimit);
}

function getDailyLimit(feature: AiUsageFeature) {
  const defaultLimit = feature === "daily_news_analysis" ? 120 : 50;
  return parsePositiveInt(process.env.AI_DAILY_CALL_LIMIT, defaultLimit);
}

function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function startOfMonthIso() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

function estimateTokens(value: unknown) {
  return Math.ceil(JSON.stringify(value).length / 4);
}

function estimateOpenAiCost(model: string | undefined, inputTokens: number, outputTokens: number) {
  if (!model) return 0;
  const normalized = model.toLowerCase();
  const rates = normalized.includes("4o-mini")
    ? { input: 0.00000015, output: 0.0000006 }
    : normalized.includes("gpt-4o")
      ? { input: 0.0000025, output: 0.00001 }
      : { input: 0.000001, output: 0.000003 };
  return Number((inputTokens * rates.input + outputTokens * rates.output).toFixed(6));
}
