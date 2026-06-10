import { NextResponse } from "next/server";
import { resolveAiUserIdFromRequest } from "@/lib/ai-usage";
import { getUserPlan } from "@/lib/user-plan";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const userId = await resolveAiUserIdFromRequest(request);
  const plan = await getUserPlan(userId);
  return NextResponse.json({
    ok: true,
    plan
  });
}
