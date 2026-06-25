export type PlanKey = "free" | "pro" | "premium" | "unlimited";

export type PlanDefinition = {
  key: PlanKey;
  name: string;
  monthlyAiCalls: number;
  dailyAiCalls: number;
  watchlistItems: number;
  monthlyPriceJpy: number;
  description: string;
  isUnlimited?: boolean;
};

const unlimitedLimit = Number.MAX_SAFE_INTEGER;

// プラン上限は Free < Pro < Premium < Unlimited の順に必ず増えるよう設計する。
export const planDefinitions: Record<PlanKey, PlanDefinition> = {
  free: {
    key: "free",
    name: "Free",
    monthlyAiCalls: 30,
    dailyAiCalls: 5,
    watchlistItems: 5,
    monthlyPriceJpy: 0,
    description: "まず試す方向け。AI診断を1日5回まで、Watchlist5銘柄まで。"
  },
  pro: {
    key: "pro",
    name: "Pro",
    monthlyAiCalls: 1000,
    dailyAiCalls: 50,
    watchlistItems: 50,
    monthlyPriceJpy: 980,
    description: "個人投資家向け。日次監視とAI診断を日常利用できるプラン。"
  },
  premium: {
    key: "premium",
    name: "Premium",
    monthlyAiCalls: 5000,
    dailyAiCalls: 300,
    watchlistItems: 200,
    monthlyPriceJpy: 2980,
    description: "多数銘柄の監視、詳細診断、将来の通知機能まで想定した上位プラン。"
  },
  unlimited: {
    key: "unlimited",
    name: "Unlimited",
    monthlyAiCalls: unlimitedLimit,
    dailyAiCalls: unlimitedLimit,
    watchlistItems: unlimitedLimit,
    monthlyPriceJpy: 0,
    description: "管理者専用。OpenAI Usage Guardの月間/日次ローカル上限を適用しないプラン。",
    isUnlimited: true
  }
};

export const paidPlanKeys: PlanKey[] = ["pro", "premium"];

export function normalizePlanKey(value: string | null | undefined): PlanKey {
  if (value === "unlimited") return value;
  if (value === "pro" || value === "premium") return value;
  return "free";
}

export function getPlanDefinition(value: string | null | undefined) {
  return planDefinitions[normalizePlanKey(value)];
}

// Stripe Price ID（サーバー側の環境変数）⇄ プランの対応。
// 値はサーバーでのみ解決される（クライアントでは undefined）。
export function priceIdForPlan(plan: PlanKey): string | undefined {
  if (plan === "pro") return process.env.STRIPE_PRICE_PRO;
  if (plan === "premium") return process.env.STRIPE_PRICE_PREMIUM;
  return undefined;
}

export function planKeyFromPriceId(priceId: string | null | undefined): PlanKey | null {
  if (!priceId) return null;
  if (priceId === process.env.STRIPE_PRICE_PRO) return "pro";
  if (priceId === process.env.STRIPE_PRICE_PREMIUM) return "premium";
  return null;
}
