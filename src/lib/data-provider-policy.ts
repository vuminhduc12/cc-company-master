export const stockDataProviderPriority = [
  "1. Yahoo Finance",
  "2. Supabase saved history",
  "3. Local verified history",
  "4. Alpha Vantage optional fallback"
] as const;

export const stockDataProviderPriorityLabel = "Yahoo Finance → Supabase保存済み → ローカル履歴";

export const stockDataProviderPolicyNote = "日足はYahoo Financeを最優先し、失敗した場合はManual AI Jobで保存済みのSupabase履歴、最後にローカル検証済み履歴を使います。Alpha Vantageは明示的に有効化した時だけ最後の補助として使います。";
