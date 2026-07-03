import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * Phase 1 の本番疎通確認用エンドポイント。
 * 秘密情報は一切返さず、「構成済みか（boolean）」と最新ジョブの鮮度のみを返す。
 * 例: https://<your-domain>/api/health
 */
export async function GET() {
  const config = {
    supabaseUrl: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    supabaseAnonKey: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    supabaseServiceRoleKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    cronSecret: Boolean(process.env.CRON_SECRET),
    openaiApiKey: Boolean(process.env.OPENAI_API_KEY),
    dailyOpenAiEnabled: process.env.ENABLE_DAILY_OPENAI === "true",
    newsApiKey: Boolean(process.env.NEWS_API_KEY),
    twelveDataKey: Boolean(process.env.TWELVE_DATA_KEY),
    stockDataProvider: process.env.STOCK_DATA_PROVIDER ?? "(default: yahoo)"
  };

  const serverSupabaseReady = config.supabaseUrl && config.supabaseServiceRoleKey;
  const aiReady = config.openaiApiKey && config.newsApiKey;

  let latestJob: {
    status: string | null;
    mode: string | null;
    lastRun: string | null;
    dataFreshness: string | null;
    ageHours: number | null;
    error: string | null;
  } | null = null;
  let supabaseReachable: boolean | null = null;

  if (serverSupabaseReady) {
    try {
      const supabase = createServerSupabase();
      const { data, error } = await supabase!
        .from("job_runs")
        .select("status, mode, last_run, data_freshness, error, created_at")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) {
        supabaseReachable = false;
      } else {
        supabaseReachable = true;
        if (data) {
          const createdAt = data.created_at ? Date.parse(String(data.created_at)) : NaN;
          latestJob = {
            status: data.status ?? null,
            mode: data.mode ?? null,
            lastRun: data.last_run ?? null,
            dataFreshness: data.data_freshness ?? null,
            ageHours: Number.isFinite(createdAt)
              ? Number(((Date.now() - createdAt) / 3_600_000).toFixed(1))
              : null,
            error: data.error ?? null
          };
        }
      }
    } catch {
      supabaseReachable = false;
    }
  }

  const checks = {
    serverSupabaseReady,
    aiReady,
    supabaseReachable,
    hasRecentJob: latestJob?.ageHours != null && latestJob.ageHours <= 26,
    cronProtected: config.cronSecret
  };

  const ready =
    serverSupabaseReady &&
    aiReady &&
    config.cronSecret &&
    supabaseReachable === true;

  const recommendations: string[] = [];
  if (!config.supabaseUrl || !config.supabaseServiceRoleKey || !config.supabaseAnonKey) {
    recommendations.push("Supabaseの3つの環境変数（URL / ANON / SERVICE_ROLE）を設定し、supabase/schema.sql を実行してください。");
  }
  if (!config.cronSecret) {
    recommendations.push("CRON_SECRET を設定してください（未設定だと自動更新が401になります）。");
  }
  if (!config.openaiApiKey || !config.newsApiKey) {
    recommendations.push("OPENAI_API_KEY と NEWS_API_KEY を設定するとAI分析が本番で動きます。");
  }
  if (config.openaiApiKey && !config.dailyOpenAiEnabled) {
    recommendations.push("ENABLE_DAILY_OPENAI が true ではないため、毎朝の自動ジョブではOpenAIを使わず、手動診断のみOpenAIを使います。");
  }
  if (!config.twelveDataKey) {
    recommendations.push("TWELVE_DATA_KEY を設定すると株価データの鮮度が安定します（無料枠あり）。");
  }
  if (supabaseReachable === false) {
    recommendations.push("Supabaseに接続できません。URL/サービスロールキーとネットワークを確認してください。");
  }
  if (serverSupabaseReady && !checks.hasRecentJob) {
    recommendations.push("直近26時間以内の成功ジョブがありません。/settings から手動実行するか、Cron設定を確認してください。");
  }

  return NextResponse.json(
    {
      ok: true,
      ready,
      checkedAt: new Date().toISOString(),
      config,
      checks,
      latestJob,
      recommendations
    },
    { status: ready ? 200 : 503 }
  );
}
