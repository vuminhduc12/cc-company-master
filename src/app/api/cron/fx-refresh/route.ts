import { NextRequest, NextResponse } from "next/server";
import { refreshUsdJpyRate } from "@/lib/fx-rates";

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const result = await refreshUsdJpyRate();
  return NextResponse.json(result.ok ? result : { ok: false, error: "FX refresh failed. Check server logs." }, {
    status: result.ok ? 200 : 502
  });
}
