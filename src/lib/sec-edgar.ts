import type { Stock } from "@/types";

const secCompanyTickersUrl = "https://www.sec.gov/files/company_tickers.json";
const secSubmissionsBaseUrl = "https://data.sec.gov/submissions";
const secCompanyFactsBaseUrl = "https://data.sec.gov/api/xbrl/companyfacts";

type SecTickerRow = {
  cik_str?: number;
  ticker?: string;
  title?: string;
};

type SecSubmissionRecent = {
  accessionNumber?: string[];
  filingDate?: string[];
  reportDate?: string[];
  form?: string[];
  primaryDocument?: string[];
  primaryDocDescription?: string[];
};

type SecSubmissionsPayload = {
  cik?: string;
  name?: string;
  tickers?: string[];
  exchanges?: string[];
  sicDescription?: string;
  filings?: {
    recent?: SecSubmissionRecent;
  };
};

type SecFactUnit = {
  accn?: string;
  fy?: number;
  fp?: string;
  form?: string;
  filed?: string;
  frame?: string;
  start?: string;
  end?: string;
  val?: number;
};

type SecCompanyFactsPayload = {
  cik?: number;
  entityName?: string;
  facts?: Record<string, Record<string, {
    label?: string;
    description?: string;
    units?: Record<string, SecFactUnit[]>;
  }>>;
};

export type SecFilingSummary = {
  form: "10-K" | "10-Q" | "8-K";
  filingDate: string;
  reportDate: string;
  accessionNumber: string;
  primaryDocument: string;
  description: string;
  url?: string;
};

export type SecFactValue = {
  tag: string;
  label: string;
  value: number;
  unit: string;
  form: string;
  fy?: number;
  fp?: string;
  filed?: string;
  end?: string;
  accessionNumber?: string;
};

export type SecCompanyFundamentals = {
  source: "SEC EDGAR";
  cik: string;
  companyName: string;
  ticker: string;
  exchange?: string;
  sicDescription?: string;
  asOf: string;
  filings: SecFilingSummary[];
  latest10K?: SecFilingSummary;
  latest10Q?: SecFilingSummary;
  latest8K?: SecFilingSummary;
  annual: {
    revenue?: SecFactValue;
    grossProfit?: SecFactValue;
    operatingIncome?: SecFactValue;
    netIncome?: SecFactValue;
  };
  quarter: {
    revenue?: SecFactValue;
    grossProfit?: SecFactValue;
    operatingIncome?: SecFactValue;
    netIncome?: SecFactValue;
  };
  balanceSheet: {
    assets?: SecFactValue;
    liabilities?: SecFactValue;
    equity?: SecFactValue;
    currentAssets?: SecFactValue;
    currentLiabilities?: SecFactValue;
    cash?: SecFactValue;
    debt?: SecFactValue;
  };
  derived: {
    currentRatio: number | null;
    debtToEquity: number | null;
    annualProfitMargin: number | null;
    quarterlyProfitMargin: number | null;
    annualRevenueGrowth: number | null;
    quarterlyRevenueGrowth: number | null;
  };
  businessSummary: string;
  balanceSheetView: string;
  incomeStatementView: string;
  filingView: string;
  limitations: string[];
};

export async function fetchSecCompanyFundamentals(stock: Stock): Promise<SecCompanyFundamentals | null> {
  if (isLikelyNonUsTicker(stock)) return null;

  const cikRow = await resolveSecTicker(stock.ticker);
  if (!cikRow?.cik_str) return null;

  const cik = String(cikRow.cik_str).padStart(10, "0");
  const [submissions, companyFacts] = await Promise.all([
    fetchSecSubmissions(cik),
    fetchSecCompanyFacts(cik)
  ]);

  const filings = buildFilingSummaries(cikRow.cik_str, submissions.filings?.recent);
  const annualRevenue = latestDurationFact(companyFacts, revenueTags, ["10-K"]);
  const previousAnnualRevenue = previousDurationFact(companyFacts, revenueTags, annualRevenue, ["10-K"]);
  const quarterlyRevenue = latestDurationFact(companyFacts, revenueTags, ["10-Q"]);
  const previousQuarterlyRevenue = previousDurationFact(companyFacts, revenueTags, quarterlyRevenue, ["10-Q"]);
  const assets = latestInstantFact(companyFacts, ["Assets"], ["10-Q", "10-K"]);
  const liabilities = latestInstantFact(companyFacts, ["Liabilities"], ["10-Q", "10-K"]);
  const equity = latestInstantFact(companyFacts, equityTags, ["10-Q", "10-K"]);
  const currentAssets = latestInstantFact(companyFacts, ["AssetsCurrent"], ["10-Q", "10-K"]);
  const currentLiabilities = latestInstantFact(companyFacts, ["LiabilitiesCurrent"], ["10-Q", "10-K"]);
  const cash = latestInstantFact(companyFacts, cashTags, ["10-Q", "10-K"]);
  const debt = latestDebtFact(companyFacts);

  const annualNetIncome = latestDurationFact(companyFacts, ["NetIncomeLoss"], ["10-K"]);
  const quarterlyNetIncome = latestDurationFact(companyFacts, ["NetIncomeLoss"], ["10-Q"]);
  const currentRatio = currentAssets?.value && currentLiabilities?.value ? currentAssets.value / currentLiabilities.value : null;
  const debtToEquity = debt?.value && equity?.value ? debt.value / equity.value : null;
  const annualProfitMargin = annualRevenue?.value && annualNetIncome?.value !== undefined ? annualNetIncome.value / annualRevenue.value : null;
  const quarterlyProfitMargin = quarterlyRevenue?.value && quarterlyNetIncome?.value !== undefined ? quarterlyNetIncome.value / quarterlyRevenue.value : null;
  const annualRevenueGrowth = annualRevenue?.value && previousAnnualRevenue?.value ? (annualRevenue.value - previousAnnualRevenue.value) / previousAnnualRevenue.value : null;
  const quarterlyRevenueGrowth = quarterlyRevenue?.value && previousQuarterlyRevenue?.value ? (quarterlyRevenue.value - previousQuarterlyRevenue.value) / previousQuarterlyRevenue.value : null;

  const result: SecCompanyFundamentals = {
    source: "SEC EDGAR",
    cik,
    companyName: submissions.name ?? companyFacts.entityName ?? cikRow.title ?? stock.companyName,
    ticker: stock.ticker,
    exchange: submissions.exchanges?.[0],
    sicDescription: submissions.sicDescription,
    asOf: new Date().toISOString(),
    filings,
    latest10K: filings.find((filing) => filing.form === "10-K"),
    latest10Q: filings.find((filing) => filing.form === "10-Q"),
    latest8K: filings.find((filing) => filing.form === "8-K"),
    annual: {
      revenue: annualRevenue,
      grossProfit: latestDurationFact(companyFacts, ["GrossProfit"], ["10-K"]),
      operatingIncome: latestDurationFact(companyFacts, operatingIncomeTags, ["10-K"]),
      netIncome: annualNetIncome
    },
    quarter: {
      revenue: quarterlyRevenue,
      grossProfit: latestDurationFact(companyFacts, ["GrossProfit"], ["10-Q"]),
      operatingIncome: latestDurationFact(companyFacts, operatingIncomeTags, ["10-Q"]),
      netIncome: quarterlyNetIncome
    },
    balanceSheet: {
      assets,
      liabilities,
      equity,
      currentAssets,
      currentLiabilities,
      cash,
      debt
    },
    derived: {
      currentRatio,
      debtToEquity,
      annualProfitMargin,
      quarterlyProfitMargin,
      annualRevenueGrowth,
      quarterlyRevenueGrowth
    },
    businessSummary: [submissions.name, submissions.sicDescription].filter(Boolean).join(" / "),
    balanceSheetView: buildSecBalanceSheetView({ assets, liabilities, equity, currentAssets, currentLiabilities, cash, debt, currentRatio, debtToEquity }),
    incomeStatementView: buildSecIncomeStatementView({ annualRevenue, previousAnnualRevenue, quarterlyRevenue, previousQuarterlyRevenue, annualNetIncome, quarterlyNetIncome, annualProfitMargin, quarterlyProfitMargin }),
    filingView: buildSecFilingView(filings),
    limitations: [
      "SEC EDGAR Submissions APIとCompany Facts APIから取得した一次情報ベースです。",
      "Company Factsは標準XBRLタグのみを集約するため、企業固有タグや注記の全文分析は別途10-K/10-Q本文確認が必要です。",
      "8-Kは提出イベント検知に使い、BS/PL数値は主に10-K/10-QのXBRLから取得します。"
    ]
  };

  return result;
}

async function resolveSecTicker(ticker: string) {
  const normalized = ticker.trim().toUpperCase().replace(/\..*$/, "");
  const response = await fetch(secCompanyTickersUrl, {
    headers: secHeaders(),
    next: { revalidate: 24 * 60 * 60 }
  });
  if (!response.ok) throw new Error(`SEC ticker map returned ${response.status}`);
  const payload = await response.json() as Record<string, SecTickerRow>;
  return Object.values(payload).find((row) => row.ticker?.toUpperCase() === normalized) ?? null;
}

async function fetchSecSubmissions(cik: string) {
  const response = await fetch(`${secSubmissionsBaseUrl}/CIK${cik}.json`, {
    headers: secHeaders(),
    next: { revalidate: 10 * 60 }
  });
  if (!response.ok) throw new Error(`SEC submissions returned ${response.status}`);
  return await response.json() as SecSubmissionsPayload;
}

async function fetchSecCompanyFacts(cik: string) {
  const response = await fetch(`${secCompanyFactsBaseUrl}/CIK${cik}.json`, {
    headers: secHeaders(),
    next: { revalidate: 10 * 60 }
  });
  if (!response.ok) throw new Error(`SEC companyfacts returned ${response.status}`);
  return await response.json() as SecCompanyFactsPayload;
}

function buildFilingSummaries(rawCik: number, recent?: SecSubmissionRecent): SecFilingSummary[] {
  if (!recent?.form?.length) return [];
  const filings: SecFilingSummary[] = [];
  for (let index = 0; index < recent.form.length; index++) {
    const form = normalizeCoreForm(recent.form[index] ?? "");
    if (!form) continue;
    const accessionNumber = recent.accessionNumber?.[index] ?? "";
    const primaryDocument = recent.primaryDocument?.[index] ?? "";
    filings.push({
      form,
      filingDate: recent.filingDate?.[index] ?? "",
      reportDate: recent.reportDate?.[index] ?? "",
      accessionNumber,
      primaryDocument,
      description: recent.primaryDocDescription?.[index] || form,
      url: accessionNumber && primaryDocument
        ? `https://www.sec.gov/Archives/edgar/data/${rawCik}/${accessionNumber.replace(/-/g, "")}/${primaryDocument}`
        : undefined
    });
  }
  return filings.slice(0, 30);
}

function normalizeCoreForm(form: string): SecFilingSummary["form"] | null {
  if (form === "10-K" || form === "10-K/A") return "10-K";
  if (form === "10-Q" || form === "10-Q/A") return "10-Q";
  if (form === "8-K" || form === "8-K/A") return "8-K";
  return null;
}

const revenueTags = [
  "RevenueFromContractWithCustomerExcludingAssessedTax",
  "Revenues",
  "SalesRevenueNet",
  "SalesRevenueGoodsNet"
];

const operatingIncomeTags = [
  "OperatingIncomeLoss",
  "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest"
];

const equityTags = [
  "StockholdersEquity",
  "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"
];

const cashTags = [
  "CashAndCashEquivalentsAtCarryingValue",
  "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"
];

const debtTags = [
  "ShortTermBorrowings",
  "ShortTermDebt",
  "LongTermDebtCurrent",
  "LongTermDebtAndFinanceLeaseObligationsCurrent",
  "LongTermDebtNoncurrent",
  "LongTermDebtAndFinanceLeaseObligationsNoncurrent"
];

function latestInstantFact(payload: SecCompanyFactsPayload, tags: string[], forms: string[]) {
  return latestFact(payload, tags, forms, "instant");
}

function latestDurationFact(payload: SecCompanyFactsPayload, tags: string[], forms: string[]) {
  return latestFact(payload, tags, forms, "duration");
}

function previousDurationFact(payload: SecCompanyFactsPayload, tags: string[], latest: SecFactValue | undefined, forms: string[]) {
  if (!latest) return undefined;
  const facts = collectFacts(payload, tags, forms, "duration")
    .filter((fact) => fact.accessionNumber !== latest.accessionNumber && (fact.end ?? "") < (latest.end ?? "9999-99-99"));
  return facts[0];
}

function latestDebtFact(payload: SecCompanyFactsPayload): SecFactValue | undefined {
  const components = debtTags
    .map((tag) => latestInstantFact(payload, [tag], ["10-Q", "10-K"]))
    .filter((fact): fact is SecFactValue => Boolean(fact));
  if (!components.length) {
    return latestInstantFact(payload, ["LongTermDebt", "DebtCurrent"], ["10-Q", "10-K"]);
  }
  const latestEnd = components.map((fact) => fact.end ?? "").sort().at(-1);
  const samePeriod = components.filter((fact) => fact.end === latestEnd);
  const total = samePeriod.reduce((sum, fact) => sum + fact.value, 0);
  const first = samePeriod[0];
  return first ? {
    ...first,
    tag: "DebtCalculated",
    label: "Debt calculated from SEC debt components",
    value: total
  } : undefined;
}

function latestFact(payload: SecCompanyFactsPayload, tags: string[], forms: string[], periodType: "instant" | "duration") {
  return collectFacts(payload, tags, forms, periodType)[0];
}

function collectFacts(payload: SecCompanyFactsPayload, tags: string[], forms: string[], periodType: "instant" | "duration"): SecFactValue[] {
  const facts: SecFactValue[] = [];
  for (const tag of tags) {
    const concept = payload.facts?.["us-gaap"]?.[tag];
    if (!concept?.units) continue;
    const unitEntries = Object.entries(concept.units);
    for (const [unit, rows] of unitEntries) {
      if (unit !== "USD" && unit !== "USD/shares" && unit !== "shares") continue;
      for (const row of rows) {
        if (!Number.isFinite(row.val)) continue;
        if (!row.form || !forms.includes(normalizeAmendedForm(row.form))) continue;
        if (periodType === "instant" && row.start) continue;
        if (periodType === "duration" && !row.start) continue;
        facts.push({
          tag,
          label: concept.label ?? tag,
          value: Number(row.val),
          unit,
          form: row.form,
          fy: row.fy,
          fp: row.fp,
          filed: row.filed,
          end: row.end,
          accessionNumber: row.accn
        });
      }
    }
  }
  return facts.sort((a, b) => {
    const endCompare = (b.end ?? "").localeCompare(a.end ?? "");
    if (endCompare !== 0) return endCompare;
    return (b.filed ?? "").localeCompare(a.filed ?? "");
  });
}

function normalizeAmendedForm(form: string) {
  if (form.endsWith("/A")) return form.slice(0, -2);
  return form;
}

function buildSecBalanceSheetView(input: {
  assets?: SecFactValue;
  liabilities?: SecFactValue;
  equity?: SecFactValue;
  currentAssets?: SecFactValue;
  currentLiabilities?: SecFactValue;
  cash?: SecFactValue;
  debt?: SecFactValue;
  currentRatio: number | null;
  debtToEquity: number | null;
}) {
  return [
    `総資産${formatSecMoney(input.assets)}、負債${formatSecMoney(input.liabilities)}、自己資本${formatSecMoney(input.equity)}。`,
    `現金${formatSecMoney(input.cash)}、有利子負債目安${formatSecMoney(input.debt)}。`,
    input.currentRatio === null ? "流動比率は算出不可。" : `流動比率は${input.currentRatio.toFixed(2)}。`,
    input.debtToEquity === null ? "D/Eは算出不可。" : `D/Eは${input.debtToEquity.toFixed(2)}。`
  ].join(" ");
}

function buildSecIncomeStatementView(input: {
  annualRevenue?: SecFactValue;
  previousAnnualRevenue?: SecFactValue;
  quarterlyRevenue?: SecFactValue;
  previousQuarterlyRevenue?: SecFactValue;
  annualNetIncome?: SecFactValue;
  quarterlyNetIncome?: SecFactValue;
  annualProfitMargin: number | null;
  quarterlyProfitMargin: number | null;
}) {
  const annualGrowth = input.annualRevenue?.value && input.previousAnnualRevenue?.value
    ? (input.annualRevenue.value - input.previousAnnualRevenue.value) / input.previousAnnualRevenue.value
    : null;
  const quarterGrowth = input.quarterlyRevenue?.value && input.previousQuarterlyRevenue?.value
    ? (input.quarterlyRevenue.value - input.previousQuarterlyRevenue.value) / input.previousQuarterlyRevenue.value
    : null;
  return [
    `年次売上${formatSecMoney(input.annualRevenue)}、年次純利益${formatSecMoney(input.annualNetIncome)}、年次純利益率${formatSecPercent(input.annualProfitMargin)}、年次売上成長率${formatSecPercent(annualGrowth)}。`,
    `四半期売上${formatSecMoney(input.quarterlyRevenue)}、四半期純利益${formatSecMoney(input.quarterlyNetIncome)}、四半期純利益率${formatSecPercent(input.quarterlyProfitMargin)}、四半期売上成長率${formatSecPercent(quarterGrowth)}。`
  ].join(" ");
}

function buildSecFilingView(filings: SecFilingSummary[]) {
  const latest10K = filings.find((filing) => filing.form === "10-K");
  const latest10Q = filings.find((filing) => filing.form === "10-Q");
  const latest8K = filings.find((filing) => filing.form === "8-K");
  return [
    latest10K ? `最新10-K: ${latest10K.filingDate}提出、対象期${latest10K.reportDate || "未記載"}。` : "10-Kは直近提出履歴から未取得。",
    latest10Q ? `最新10-Q: ${latest10Q.filingDate}提出、対象期${latest10Q.reportDate || "未記載"}。` : "10-Qは直近提出履歴から未取得。",
    latest8K ? `最新8-K: ${latest8K.filingDate}提出、${latest8K.description}。` : "8-Kは直近提出履歴から未取得。"
  ].join(" ");
}

function formatSecMoney(fact?: SecFactValue) {
  if (!fact) return "未取得";
  return `${new Intl.NumberFormat("ja-JP", { notation: "compact", maximumFractionDigits: 2 }).format(fact.value)} USD${fact.end ? ` (${fact.end})` : ""}`;
}

function formatSecPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "未取得";
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;
}

function isLikelyNonUsTicker(stock: Stock) {
  return stock.ticker.endsWith(".T") || stock.exchange.toUpperCase().includes("TSE");
}

function secHeaders() {
  return {
    "user-agent": process.env.SEC_USER_AGENT ?? "cc-company-master admin@example.com",
    accept: "application/json"
  };
}
