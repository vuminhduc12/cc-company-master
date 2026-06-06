import { NextResponse } from "next/server";
import { getPersistedAiUsageSummary, resolveAiUserIdFromRequest } from "@/lib/ai-usage";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const userId = await resolveAiUserIdFromRequest(request);
  return NextResponse.json({
    ok: true,
    summary: await getPersistedAiUsageSummary(userId)
  });
}
