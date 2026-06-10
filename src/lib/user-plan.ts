import { getPlanDefinition, normalizePlanKey } from "@/lib/plans";
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
