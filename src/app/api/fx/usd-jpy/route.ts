import { NextResponse } from "next/server";
import { getUsdJpyRate } from "@/lib/fx-rates";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getUsdJpyRate(), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, error: "日次の為替レートを取得できません。" }, { status: 503 });
  }
}
