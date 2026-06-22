import { randomUUID } from "crypto";
import type { PlanDefinition } from "@/lib/plans";
import { createServerSupabase } from "@/lib/supabase";
import { getUserPlan } from "@/lib/user-plan";

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
  plan: PlanDefinition;
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
let lastPruneAt = 0;

export function getAiUserId() {
  return defaultUserId;
}

export async function resolveAiUserIdFromRequest(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return defaultUserId;
  const supabase = createServerSupabase();
  if (!supabase) return defaultUserId;
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user?.id) return defaultUserId;
  return data.user.id;
}

export async function recordAiUsage(input: Omit<AiUsageLog, "id" | "userId" | "createdAt" | "estimatedCostUsd"> & {
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
  // サーバーレス環境ではレスポンス後に実行が凍結されうるため、書き込みを待機してログ欠損を防ぐ。
  await saveAiUsageLogToSupabase(log);
  return log;
}

export async function recordAiCacheHit(input: {
  feature: AiUsageFeature;
  userId?: string;
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
  userId?: string;
  ticker?: string;
  model: string;
  promptVersion?: string;
  estimatedInputTokens?: number;
  body: Record<string, unknown>;
  apiKey?: string;
}): Promise<OpenAiChatResult<T>> {
  const userId = input.userId ?? defaultUserId;
  const plan = await getUserPlan(userId);
  const allowed = await canUseAi(input.feature, userId, plan);
  if (!allowed.allowed) {
    await recordAiUsage({
      userId,
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
    await recordAiUsage({
      userId,
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
    await recordAiUsage({
      userId,
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

  await recordAiUsage({
    userId,
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
  return buildAiUsageSummary(monthlyLogs, userId, monthStart, getLocalFallbackPlan());
}

export async function getPersistedAiUsageSummary(userId = defaultUserId): Promise<AiUsageSummary> {
  const monthStart = startOfMonthIso();
  const plan = await getUserPlan(userId);
  const persistedLogs = await loadAiUsageLogsFromSupabase(userId, monthStart);
  if (persistedLogs) return buildAiUsageSummary(persistedLogs, userId, monthStart, plan);
  const memoryLogs = usageLogs.filter((log) => log.userId === userId && log.createdAt >= monthStart);
  return buildAiUsageSummary(memoryLogs, userId, monthStart, plan);
}

function buildAiUsageSummary(monthlyLogs: AiUsageLog[], userId: string, monthStart: string, plan: PlanDefinition): AiUsageSummary {
  const monthlyLimit = plan.monthlyAiCalls;
  const billableCalls = monthlyLogs.filter((log) => log.status === "success").length;
  const rateLimitLogs = monthlyLogs.filter((log) => log.errorCode === "429");
  return {
    userId,
    plan,
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

async function saveAiUsageLogToSupabase(log: AiUsageLog) {
  try {
    const supabase = createServerSupabase();
    if (!supabase) return;
    await maybePruneOldAiUsageLogs(supabase);
    await supabase.from("ai_usage_logs").insert({
      id: log.id,
      user_id: log.userId,
      feature: log.feature,
      ticker: log.ticker,
      model: log.model,
      prompt_version: log.promptVersion,
      status: log.status,
      error_code: log.errorCode,
      error_message: log.errorMessage,
      used_cache: log.usedCache,
      input_tokens: log.inputTokens,
      output_tokens: log.outputTokens,
      estimated_cost_usd: log.estimatedCostUsd,
      created_at: log.createdAt
    });
  } catch {
    // Supabase persistence is optional in local/free-tier setups; memory logs still keep the app usable.
  }
}

async function loadAiUsageLogsFromSupabase(userId: string, monthStart: string) {
  const supabase = createServerSupabase();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("ai_usage_logs")
    .select("*")
    .eq("user_id", userId)
    .gte("created_at", monthStart)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error || !data) return null;
  return data.map((row) => aiUsageLogFromRow(row as AiUsageLogRow));
}

async function maybePruneOldAiUsageLogs(supabase: ReturnType<typeof createServerSupabase>) {
  if (!supabase) return;
  const now = Date.now();
  if (now - lastPruneAt < 6 * 60 * 60 * 1000) return;
  lastPruneAt = now;
  const retentionDays = parsePositiveInt(process.env.AI_USAGE_RETENTION_DAYS, 90);
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  await supabase.from("ai_usage_logs").delete().lt("created_at", cutoff);
}

type AiUsageLogRow = {
  id?: string | null;
  user_id?: string | null;
  feature?: string | null;
  ticker?: string | null;
  model?: string | null;
  prompt_version?: string | null;
  status?: string | null;
  error_code?: string | null;
  error_message?: string | null;
  used_cache?: boolean | null;
  input_tokens?: number | string | null;
  output_tokens?: number | string | null;
  estimated_cost_usd?: number | string | null;
  created_at?: string | null;
};

function aiUsageLogFromRow(row: AiUsageLogRow): AiUsageLog {
  const feature = row.feature === "daily_news_analysis" || row.feature === "spot_diagnosis" || row.feature === "spot_question"
    ? row.feature
    : "spot_diagnosis";
  const status = row.status === "success" || row.status === "cache_hit" || row.status === "fallback" || row.status === "limit_exceeded" || row.status === "error"
    ? row.status
    : "error";
  return {
    id: row.id ?? randomUUID(),
    userId: row.user_id ?? defaultUserId,
    feature,
    ticker: row.ticker ?? undefined,
    model: row.model ?? undefined,
    promptVersion: row.prompt_version ?? undefined,
    status,
    errorCode: row.error_code ?? undefined,
    errorMessage: row.error_message ?? undefined,
    usedCache: Boolean(row.used_cache),
    inputTokens: numberFrom(row.input_tokens),
    outputTokens: numberFrom(row.output_tokens),
    estimatedCostUsd: numberFrom(row.estimated_cost_usd),
    createdAt: row.created_at ?? new Date().toISOString()
  };
}

function numberFrom(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function canUseAi(feature: AiUsageFeature, userId = defaultUserId, plan = getLocalFallbackPlan()) {
  const monthStart = startOfMonthIso();
  let monthlyLogs: AiUsageLog[];
  if (hasServerSupabaseConfig()) {
    // Supabaseが構成済みの本番では、Supabaseを利用量の真実の源とする。
    const persisted = await loadAiUsageLogsFromSupabase(userId, monthStart);
    if (persisted === null) {
      // 構成済みなのに取得失敗 = メモリにフォールバックすると上限が事実上無効になり
      // OpenAIコストが青天井になる。既定では fail-closed でAI実行を停止する。
      if (process.env.AI_FAIL_CLOSED !== "false") {
        return { allowed: false, reason: "利用量データベースに接続できないため、コスト保護のためAI実行を一時停止しました。時間をおいて再試行してください。" };
      }
      monthlyLogs = usageLogs.filter((log) => log.userId === userId && log.createdAt >= monthStart);
    } else {
      monthlyLogs = persisted;
    }
  } else {
    // Supabase未構成（ローカル開発など）はメモリ集計で動かす。
    monthlyLogs = usageLogs.filter((log) => log.userId === userId && log.createdAt >= monthStart);
  }
  const summary = buildAiUsageSummary(monthlyLogs, userId, monthStart, plan);
  const monthlyLimit = plan.monthlyAiCalls;
  if (summary.billableCalls >= monthlyLimit) {
    return { allowed: false, reason: `月間AI利用上限 ${monthlyLimit} 回に達しています。` };
  }
  const dailyLimit = getDailyLimit(feature, plan);
  const today = new Date().toISOString().slice(0, 10);
  const todaySuccess = monthlyLogs.filter((log) => log.createdAt.startsWith(today) && log.status === "success" && log.feature === feature).length;
  if (todaySuccess >= dailyLimit) {
    return { allowed: false, reason: `本日の${feature}利用上限 ${dailyLimit} 回に達しています。` };
  }
  return { allowed: true };
}

function getDailyLimit(_feature: AiUsageFeature, plan: PlanDefinition) {
  return parsePositiveInt(process.env.AI_DAILY_CALL_LIMIT, plan.dailyAiCalls);
}

function hasServerSupabaseConfig() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function getLocalFallbackPlan(): PlanDefinition {
  return {
    key: "free" as const,
    name: "Free",
    monthlyAiCalls: parsePositiveInt(process.env.AI_MONTHLY_CALL_LIMIT, 10),
    dailyAiCalls: parsePositiveInt(process.env.AI_DAILY_CALL_LIMIT, 10),
    watchlistItems: 5,
    description: "ローカル未ログイン用プラン"
  };
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
  const rates = openAiTokenRates(normalized);
  return Number((inputTokens * rates.input + outputTokens * rates.output).toFixed(6));
}

function openAiTokenRates(normalizedModel: string) {
  if (normalizedModel.includes("gpt-5.5")) return { input: 0.000005, output: 0.00003 };
  if (normalizedModel.includes("gpt-5.4-mini")) return { input: 0.00000075, output: 0.0000045 };
  if (normalizedModel.includes("gpt-5.4-nano")) return { input: 0.0000002, output: 0.00000125 };
  if (normalizedModel.includes("gpt-5.4")) return { input: 0.0000025, output: 0.000015 };
  if (normalizedModel.includes("4o-mini")) return { input: 0.00000015, output: 0.0000006 };
  if (normalizedModel.includes("gpt-4o")) return { input: 0.0000025, output: 0.00001 };
  return { input: 0.000001, output: 0.000003 };
}
