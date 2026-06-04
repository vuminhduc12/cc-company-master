import { NextResponse } from "next/server";
import { getPersistedAiUsageSummary } from "@/lib/ai-usage";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    summary: await getPersistedAiUsageSummary()
  });
}
