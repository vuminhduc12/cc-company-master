export const stockDataProviderPriority = [
  "1. Twelve Data（TWELVE_DATA_KEY 設定時）",
  "2. Yahoo Finance（バックアップ）",
  "3. Supabase 保存済み履歴",
  "4. ローカル検証済み履歴",
  "5. Alpha Vantage（ENABLE_ALPHA_VANTAGE_FALLBACK=true 時のみ）"
] as const;

export const stockDataProviderPriorityLabel =
  "Twelve Data → Yahoo Finance → Supabase保存済み → ローカル履歴";

export const stockDataProviderPolicyNote =
  "TWELVE_DATA_KEY が設定されている場合は Twelve Data（公式・無料800 credits/日）を最優先します。" +
  "未設定または失敗した場合は Yahoo Finance（非公式）にフォールバック。" +
  "外部API全滅時は Supabase 保存済み履歴 → ローカル検証済み履歴の順で表示します。" +
  "Alpha Vantage は ENABLE_ALPHA_VANTAGE_FALLBACK=true の場合のみ最終補助として有効化されます。";
