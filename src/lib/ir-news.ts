import type { NewsItem, WatchlistItem } from "@/types";

const secCompanyTickersUrl = "https://www.sec.gov/files/company_tickers.json";
const secSubmissionsBaseUrl = "https://data.sec.gov/submissions";
const tdnetListBaseUrl = "https://www.release.tdnet.info/inbs";
const irLookbackDays = 3;
const maxIrNewsPerTicker = 8;
const secIrForms = new Set(["8-K", "10-K", "10-Q", "20-F", "6-K", "S-1", "S-3", "424B5", "SC 13G", "SC 13D"]);

type SecTickerRow = {
  cik_str?: number;
  ticker?: string;
  title?: string;
};

type SecSubmissionsPayload = {
  name?: string;
  filings?: {
    recent?: {
      accessionNumber?: string[];
      filingDate?: string[];
      reportDate?: string[];
      form?: string[];
      primaryDocument?: string[];
      primaryDocDescription?: string[];
    };
  };
};

type IrTarget = {
  ticker: string;
  companyName: string;
  market: "us" | "jp";
};

export type IrNewsScanResult = {
  news: NewsItem[];
  scanned: number;
  failed: number;
  errors: string[];
};

export async function scanIrNewsForWatchlist(items: WatchlistItem[]): Promise<IrNewsScanResult> {
  const targets = uniqueTargets(items);
  const news: NewsItem[] = [];
  const errors: string[] = [];
  let failed = 0;

  const usTargets = targets.filter((target) => target.market === "us");
  const jpTargets = targets.filter((target) => target.market === "jp");

  if (usTargets.length) {
    try {
      const secMap = await loadSecTickerMap();
      for (const target of usTargets) {
        try {
          news.push(...await fetchSecFilingsForTicker(target, secMap));
        } catch (error) {
          failed++;
          errors.push(`${target.ticker} SEC: ${errorMessage(error)}`);
        }
      }
    } catch (error) {
      failed += usTargets.length;
      errors.push(`SEC ticker map: ${errorMessage(error)}`);
    }
  }

  if (jpTargets.length) {
    try {
      news.push(...await fetchTdnetDisclosures(jpTargets));
    } catch (error) {
      failed += jpTargets.length;
      errors.push(`TDnet: ${errorMessage(error)}`);
    }
  }

  return {
    news: uniqueNews(news).slice(0, targets.length * maxIrNewsPerTicker),
    scanned: targets.length,
    failed,
    errors
  };
}

function uniqueTargets(items: WatchlistItem[]) {
  const seen = new Set<string>();
  const targets: IrTarget[] = [];
  for (const item of items) {
    const ticker = item.stock.ticker.trim().toUpperCase();
    if (!ticker || seen.has(ticker)) continue;
    seen.add(ticker);
    targets.push({
      ticker,
      companyName: item.stock.companyName || ticker,
      market: ticker.endsWith(".T") || item.stock.exchange === "TSE" ? "jp" : "us"
    });
  }
  return targets;
}

async function loadSecTickerMap() {
  const response = await fetch(secCompanyTickersUrl, {
    headers: secHeaders(),
    next: { revalidate: 24 * 60 * 60 }
  });
  if (!response.ok) throw new Error(`SEC ticker map returned ${response.status}`);
  const payload = await response.json() as Record<string, SecTickerRow>;
  const map = new Map<string, SecTickerRow>();
  Object.values(payload).forEach((row) => {
    if (row.ticker) map.set(row.ticker.toUpperCase(), row);
  });
  return map;
}

async function fetchSecFilingsForTicker(target: IrTarget, secMap: Map<string, SecTickerRow>) {
  const row = secMap.get(target.ticker.replace(/\..*$/, ""));
  if (!row?.cik_str) return [];
  const cik = String(row.cik_str).padStart(10, "0");
  const response = await fetch(`${secSubmissionsBaseUrl}/CIK${cik}.json`, {
    headers: secHeaders(),
    next: { revalidate: 10 * 60 }
  });
  if (!response.ok) throw new Error(`SEC submissions returned ${response.status}`);

  const payload = await response.json() as SecSubmissionsPayload;
  const recent = payload.filings?.recent;
  if (!recent?.form?.length) return [];

  const news: NewsItem[] = [];
  for (let index = 0; index < recent.form.length; index++) {
    const form = recent.form[index] ?? "";
    if (!isSecIrForm(form)) continue;
    const filingDate = recent.filingDate?.[index] ?? "";
    if (!isRecentDate(filingDate, irLookbackDays)) continue;
    const accession = recent.accessionNumber?.[index] ?? "";
    const document = recent.primaryDocument?.[index] ?? "";
    const url = accession && document
      ? `https://www.sec.gov/Archives/edgar/data/${Number(row.cik_str)}/${accession.replace(/-/g, "")}/${document}`
      : undefined;
    const description = recent.primaryDocDescription?.[index] || form;
    news.push({
      title: `${target.ticker} ${form}: ${description}`,
      url,
      source: "SEC EDGAR",
      publishedAt: filingDate,
      ticker: target.ticker,
      summary: `${payload.name ?? target.companyName}がSECへ${form}を提出しました。開示本文で業績、契約、資金調達、リスク要因を確認してください。`,
      sentiment: "Neutral",
      impactScore: secImpactScore(form),
      risk: "重要開示の可能性があります。詳細本文と提出理由を確認してください。",
      opportunity: "決算、契約、資金調達、事業進捗など株価材料の早期検知に使えます。",
      aiComment: "APIキー不要のSEC EDGAR監視で検出しました。AI分析は行っていません。"
    });
  }
  return news.slice(0, maxIrNewsPerTicker);
}

async function fetchTdnetDisclosures(targets: IrTarget[]) {
  const targetCodes = new Map(targets.map((target) => [target.ticker.replace(/\.T$/, ""), target]));
  const news: NewsItem[] = [];
  for (const date of recentJstDates(irLookbackDays)) {
    const response = await fetch(`${tdnetListBaseUrl}/I_list_001_${date}.html`, {
      next: { revalidate: 10 * 60 }
    });
    if (!response.ok) continue;
    const html = await response.text();
    for (const row of parseTdnetRows(html, date)) {
      const target = targetCodes.get(row.code);
      if (!target) continue;
      news.push({
        title: `${target.ticker} ${row.title}`,
        url: row.url,
        source: "TDnet",
        publishedAt: row.publishedAt,
        ticker: target.ticker,
        summary: `${target.companyName}のTDnet適時開示です。タイトルとPDF本文で決算、業績修正、配当、資本政策、重要契約を確認してください。`,
        sentiment: "Neutral",
        impactScore: tdnetImpactScore(row.title),
        risk: "開示内容によっては業績見通し、希薄化、上場維持、資本政策リスクがあります。",
        opportunity: "決算、上方修正、配当、提携、自己株買いなどの材料を早期検知できます。",
        aiComment: "APIキー不要のTDnet監視で検出しました。AI分析は行っていません。"
      });
    }
  }
  return uniqueNews(news).slice(0, targets.length * maxIrNewsPerTicker);
}

function parseTdnetRows(html: string, yyyymmdd: string) {
  const rows: Array<{ code: string; title: string; url?: string; publishedAt: string }> = [];
  const rowMatches = html.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
  for (const rowHtml of rowMatches) {
    const text = stripTags(rowHtml);
    const code = text.match(/\b(\d{4})\b/)?.[1];
    if (!code) continue;
    const href = rowHtml.match(/href=["']([^"']+\.pdf[^"']*)["']/i)?.[1];
    const title = normalizeWhitespace(decodeHtml(stripTags(rowHtml.replace(/^[\s\S]*?\b\d{4}\b/, ""))));
    if (!title) continue;
    const time = text.match(/\b(\d{1,2}:\d{2})\b/)?.[1] ?? "00:00";
    rows.push({
      code,
      title: title.slice(0, 180),
      url: href ? new URL(href, `${tdnetListBaseUrl}/`).toString() : undefined,
      publishedAt: `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}T${time}:00+09:00`
    });
  }
  return rows;
}

function isSecIrForm(form: string) {
  return secIrForms.has(form) || form.startsWith("8-K") || form.startsWith("6-K");
}

function secImpactScore(form: string) {
  if (form.startsWith("8-K") || form.startsWith("6-K")) return 8;
  if (form === "10-K" || form === "10-Q" || form === "20-F") return 7;
  if (form.startsWith("S-") || form.startsWith("424B")) return 8;
  return 6;
}

function tdnetImpactScore(title: string) {
  if (/業績予想|修正|配当|自己株|TOB|公開買付|増資|第三者割当|決算短信/.test(title)) return 8;
  if (/適時開示|契約|提携|資本|子会社|譲渡|取得/.test(title)) return 7;
  return 6;
}

function isRecentDate(value: string, days: number) {
  const time = new Date(`${value}T00:00:00Z`).getTime();
  if (!Number.isFinite(time)) return false;
  return Date.now() - time <= days * 24 * 60 * 60 * 1000;
}

function recentJstDates(days: number) {
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(Date.now() - index * 24 * 60 * 60 * 1000);
    return jstDateKey(date).replace(/-/g, "");
  });
}

function jstDateKey(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function uniqueNews(items: NewsItem[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.ticker}|${item.publishedAt}|${item.source}|${item.url ?? item.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function secHeaders() {
  return {
    "user-agent": process.env.SEC_USER_AGENT ?? "cc-company-master admin@example.com",
    accept: "application/json"
  };
}

function stripTags(value: string) {
  return value.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ");
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}
