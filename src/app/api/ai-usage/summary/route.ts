import { NextResponse } from "next/server";
import { getPersistedAiUsageSummary, resolveAiUserFromRequest } from "@/lib/ai-usage";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await resolveAiUserFromRequest(request);
  return NextResponse.json({
    ok: true,
    summary: await getPersistedAiUsageSummary(user.id, user.email)
  });
}
