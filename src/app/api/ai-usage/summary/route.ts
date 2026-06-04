import { NextResponse } from "next/server";
import { getAiUsageSummary } from "@/lib/ai-usage";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    summary: getAiUsageSummary()
  });
}
