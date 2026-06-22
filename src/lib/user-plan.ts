import { getPlanDefinition, normalizePlanKey, type PlanKey } from "@/lib/plans";
import { createServerSupabase } from "@/lib/supabase";

export async function getUserPlan(userId: string) {
  if (userId === "local-user") {
    return getPlanDefinition(process.env.LOCAL_USER_PLAN ?? process.env.DEFAULT_USER_PLAN);
  }

  const supabase = createServerSupabase();
  if (!supabase) return getPlanDefinition(process.env.DEFAULT_USER_PLAN);

  const { data, error } = await supabase
    .from("user_plans")
    .select("plan")
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data?.plan) return getPlanDefinition(process.env.DEFAULT_USER_PLAN);
  return getPlanDefinition(normalizePlanKey(String(data.plan)));
}

export async function getUserPlanRow(userId: string) {
  const supabase = createServerSupabase();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("user_plans")
    .select("user_id, plan, stripe_customer_id, stripe_subscription_id, subscription_status")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return null;
  return data;
}

type UserPlanUpdate = {
  plan?: PlanKey;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  subscriptionStatus?: string | null;
};

// Checkout完了時など、userIdが分かる場合のupsert。
export async function upsertUserPlanByUserId(userId: string, update: UserPlanUpdate) {
  const supabase = createServerSupabase();
  if (!supabase) throw new Error("Supabase service role is not configured.");
  const row: Record<string, unknown> = { user_id: userId, updated_at: new Date().toISOString() };
  if (update.plan !== undefined) row.plan = update.plan;
  if (update.stripeCustomerId !== undefined) row.stripe_customer_id = update.stripeCustomerId;
  if (update.stripeSubscriptionId !== undefined) row.stripe_subscription_id = update.stripeSubscriptionId;
  if (update.subscriptionStatus !== undefined) row.subscription_status = update.subscriptionStatus;
  const { error } = await supabase.from("user_plans").upsert(row, { onConflict: "user_id" });
  if (error) throw new Error(`user_plans upsert failed: ${error.message}`);
}

// subscription.updated / deleted など、Stripe顧客IDからの更新。
export async function updateUserPlanByCustomerId(customerId: string, update: UserPlanUpdate) {
  const supabase = createServerSupabase();
  if (!supabase) throw new Error("Supabase service role is not configured.");
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (update.plan !== undefined) row.plan = update.plan;
  if (update.stripeSubscriptionId !== undefined) row.stripe_subscription_id = update.stripeSubscriptionId;
  if (update.subscriptionStatus !== undefined) row.subscription_status = update.subscriptionStatus;
  const { error } = await supabase
    .from("user_plans")
    .update(row)
    .eq("stripe_customer_id", customerId);
  if (error) throw new Error(`user_plans update by customer failed: ${error.message}`);
}
