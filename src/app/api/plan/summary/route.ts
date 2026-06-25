import { NextResponse } from "next/server";
import { resolveAiUserFromRequest } from "@/lib/ai-usage";
import { getUserPlan } from "@/lib/user-plan";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await resolveAiUserFromRequest(request);
  const plan = await getUserPlan(user.id, user.email);
  return NextResponse.json({
    ok: true,
    plan
  });
}
