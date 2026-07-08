import { fetchJQuants, hasJQuantsConfig } from "@/lib/jquants";
import { isJapaneseStockTicker, toJQuantsStockCode } from "@/lib/jp-ticker";
import type { ShortSellingDisclosure } from "@/types";

type JQuantsShortSaleRow = {
  DiscDate?: string;
  CalcDate?: string;
  Code?: string;
  SSName?: string;
  SSAddr?: string;
  DICName?: string;
  DICAddr?: string;
  FundName?: string;
  ShrtPosToSO?: number | string;
  ShrtPosShares?: number | string;
  ShrtPosUnits?: number | string;
  PrevRptDate?: string;
  PrevRptRatio?: number | string;
  Notes?: string;
};

type JQuantsShortSaleResponse = {
  data?: JQuantsShortSaleRow[];
  pagination_key?: string;
};

export type ShortSellingFetchResult = {
  ok: true;
  ticker: string;
  code: string;
  configured: boolean;
  provider: "jquants" | "unavailable";
  sourceLabel: string;
  disclosures: ShortSellingDisclosure[];
  latestDisclosedDate: string | null;
  fetchedAt: string;
  warning?: string;
};

export function canFetchShortSellingData(ticker: string) {
  return isJapaneseStockTicker(ticker);
}

export async function fetchShortSellingDisclosures(ticker: string): Promise<ShortSellingFetchResult> {
  const code = toJQuantsStockCode(ticker);
  if (!isJapaneseStockTicker(ticker)) {
    throw new Error("空売り残高報告は日本株（4桁コード）のみ対応しています。");
  }

  if (!hasJQuantsConfig()) {
    return {
      ok: true,
      ticker,
      code,
      configured: false,
      provider: "unavailable",
      sourceLabel: "J-Quants API 未設定",
      disclosures: [],
      latestDisclosedDate: null,
      fetchedAt: new Date().toISOString(),
      warning: "JQUANTS_API_KEY を設定すると、JPX公表と同等の空売り残高報告を取得できます。"
    };
  }

  const rows = await fetchAllShortSaleRows(code);
  const disclosures = rows
    .map(mapShortSaleRow)
    .sort((a, b) => b.disclosedDate.localeCompare(a.disclosedDate) || b.ratioPercent - a.ratioPercent);

  return {
    ok: true,
    ticker,
    code,
    configured: true,
    provider: "jquants",
    sourceLabel: "J-Quants / 空売り残高報告",
    disclosures,
    latestDisclosedDate: disclosures[0]?.disclosedDate ?? null,
    fetchedAt: new Date().toISOString()
  };
}

async function fetchAllShortSaleRows(code: string) {
  const rows: JQuantsShortSaleRow[] = [];
  let paginationKey = "";

  for (let page = 0; page < 20; page += 1) {
    const query: Record<string, string> = { code };
    if (paginationKey) query.pagination_key = paginationKey;

    const payload = await fetchJQuants<JQuantsShortSaleResponse>("/markets/short-sale-report", query);
    rows.push(...(payload.data ?? []));
    paginationKey = payload.pagination_key?.trim() ?? "";
    if (!paginationKey) break;
  }

  return rows;
}

function mapShortSaleRow(row: JQuantsShortSaleRow): ShortSellingDisclosure {
  const ratio = numberFrom(row.ShrtPosToSO);
  const previousRatio = numberFrom(row.PrevRptRatio);
  return {
    disclosedDate: row.DiscDate ?? "",
    calculatedDate: row.CalcDate ?? "",
    code: row.Code ?? "",
    reporterName: row.SSName ?? "不明",
    reporterAddress: row.SSAddr ?? "",
    delegateName: row.DICName ?? "",
    fundName: row.FundName ?? "",
    ratioPercent: ratio * 100,
    shares: numberFrom(row.ShrtPosShares),
    tradingUnits: numberFrom(row.ShrtPosUnits),
    previousReportDate: row.PrevRptDate ?? "",
    previousRatioPercent: previousRatio * 100,
    notes: row.Notes ?? ""
  };
}

function numberFrom(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
