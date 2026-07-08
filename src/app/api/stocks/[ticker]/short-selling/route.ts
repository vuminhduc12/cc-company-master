import { NextRequest, NextResponse } from "next/server";
import { canFetchShortSellingData, fetchShortSellingDisclosures } from "@/lib/short-selling-data";

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ ticker: string }> }) {
  try {
    const { ticker } = await params;
    const normalizedTicker = ticker.trim().toUpperCase();

    if (!canFetchShortSellingData(normalizedTicker)) {
      return NextResponse.json({
        ok: false,
        error: "空売り残高報告は日本株（例: 7203 / 7203.T）のみ対応しています。"
      }, { status: 400 });
    }

    const result = await fetchShortSellingDisclosures(normalizedTicker);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "空売り残高報告の取得に失敗しました。"
    }, { status: 500 });
  }
}
