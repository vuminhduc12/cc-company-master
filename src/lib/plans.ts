export type PlanKey = "free" | "pro" | "premium";

export type PlanDefinition = {
  key: PlanKey;
  name: string;
  monthlyAiCalls: number;
  dailyAiCalls: number;
  watchlistItems: number;
  description: string;
};

export const planDefinitions: Record<PlanKey, PlanDefinition> = {
  free: {
    key: "free",
    name: "Free",
    monthlyAiCalls: 10,
    dailyAiCalls: 10,
    watchlistItems: 5,
    description: "検証用。少数銘柄と少ないAI診断で使うプラン。"
  },
  pro: {
    key: "pro",
    name: "Pro",
    monthlyAiCalls: 300,
    dailyAiCalls: 120,
    watchlistItems: 30,
    description: "個人投資家向け。日次監視とAI診断を日常利用できるプラン。"
  },
  premium: {
    key: "premium",
    name: "Premium",
    monthlyAiCalls: 2000,
    dailyAiCalls: 600,
    watchlistItems: 100,
    description: "多数銘柄の監視、詳細診断、将来の通知機能まで想定した上位プラン。"
  }
};

export function normalizePlanKey(value: string | null | undefined): PlanKey {
  if (value === "pro" || value === "premium") return value;
  return "free";
}

export function getPlanDefinition(value: string | null | undefined) {
  return planDefinitions[normalizePlanKey(value)];
}
