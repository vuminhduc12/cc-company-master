export type MacroMetric = {
  id: string;
  label: string;
  value: number | null;
  previous: number | null;
  change: number | null;
  unit: string;
  date: string;
  source: string;
};

export type MacroMarketOutlook = {
  scenario: "risk_on" | "range" | "risk_off";
  confidence: "低" | "中" | "高";
  score: number;
  summary: string;
  drivers: string[];
  risks: string[];
  metrics: MacroMetric[];
  fedPolicy: FedPolicySnapshot | null;
  generatedAt: string;
  dataSource: string;
  aiComment?: string;
  warning?: string;
};

export type FedPolicySnapshot = {
  lowerBound: number | null;
  upperBound: number | null;
  midpoint: number | null;
  effectiveRate: number | null;
  monthlyChange: number | null;
  stance: "easing" | "neutral" | "tightening";
  date: string;
  summary: string;
};

type FredPoint = {
  date: string;
  value: number;
};

const fredSeries = [
  { id: "CPIAUCSL", label: "CPI YoY", unit: "%", transform: "yoy" as const },
  { id: "CPILFESL", label: "Core CPI YoY", unit: "%", transform: "yoy" as const },
  { id: "FEDFUNDS", label: "Fed Funds", unit: "%", transform: "level" as const },
  { id: "DFEDTARL", label: "FOMC Lower", unit: "%", transform: "level" as const },
  { id: "DFEDTARU", label: "FOMC Upper", unit: "%", transform: "level" as const },
  { id: "DGS10", label: "10Y Yield", unit: "%", transform: "level" as const },
  { id: "DGS2", label: "2Y Yield", unit: "%", transform: "level" as const },
  { id: "VIXCLS", label: "VIX", unit: "", transform: "level" as const },
  { id: "SP500", label: "S&P 500", unit: "", transform: "mom" as const },
  { id: "UNRATE", label: "Unemployment", unit: "%", transform: "level" as const }
];

export async function buildMacroMarketOutlook(): Promise<MacroMarketOutlook> {
  const settled = await Promise.allSettled(fredSeries.map(fetchMacroMetric));
  const metrics = settled
    .filter((result): result is PromiseFulfilledResult<MacroMetric> => result.status === "fulfilled")
    .map((result) => result.value);
  const failed = settled.length - metrics.length;
  const score = scoreMacro(metrics);
  const scenario = score >= 62 ? "risk_on" : score <= 42 ? "risk_off" : "range";
  const confidence = metrics.length >= 6 ? "中" : "低";
  const fedPolicy = buildFedPolicySnapshot(metrics);
  const drivers = buildDrivers(metrics, score, fedPolicy);
  const risks = buildRisks(metrics);

  return {
    scenario,
    confidence,
    score,
    summary: buildRuleSummary(scenario, metrics),
    drivers,
    risks,
    metrics,
    fedPolicy,
    generatedAt: new Date().toISOString(),
    dataSource: "FRED public CSV",
    warning: failed ? `${failed}件のマクロ指標を取得できませんでした。` : undefined
  };
}

async function fetchMacroMetric(series: typeof fredSeries[number]): Promise<MacroMetric> {
  const points = await fetchFredSeries(series.id);
  const current = latestNumeric(points);
  if (!current) throw new Error(`${series.id} has no numeric data`);
  const previous = previousPoint(points, current.date, series.transform === "yoy" ? 12 : 1);

  if (series.transform === "yoy") {
    const value = previous ? ((current.value / previous.value) - 1) * 100 : null;
    const beforePrevious = previous ? previousPoint(points, previous.date, 1) : null;
    const previousYoy = previous && beforePrevious ? ((previous.value / beforePrevious.value) - 1) * 100 : null;
    return metricFrom(series, current.date, value, previousYoy);
  }

  if (series.transform === "mom") {
    const value = current.value;
    const change = previous ? ((current.value / previous.value) - 1) * 100 : null;
    return {
      id: series.id,
      label: series.label,
      value,
      previous: previous?.value ?? null,
      change,
      unit: series.unit,
      date: current.date,
      source: "FRED"
    };
  }

  return {
    id: series.id,
    label: series.label,
    value: current.value,
    previous: previous?.value ?? null,
    change: previous ? current.value - previous.value : null,
    unit: series.unit,
    date: current.date,
    source: "FRED"
  };
}

async function fetchFredSeries(id: string): Promise<FredPoint[]> {
  const response = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(id)}`, {
    next: { revalidate: 60 * 60 }
  });
  if (!response.ok) throw new Error(`FRED ${id} returned ${response.status}`);
  const csv = await response.text();
  return csv
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((line) => {
      const [date, rawValue] = line.split(",");
      const value = Number(rawValue);
      return { date, value };
    })
    .filter((point) => point.date && Number.isFinite(point.value));
}

function metricFrom(series: typeof fredSeries[number], date: string, value: number | null, previous: number | null): MacroMetric {
  return {
    id: series.id,
    label: series.label,
    value,
    previous,
    change: value !== null && previous !== null ? value - previous : null,
    unit: series.unit,
    date,
    source: "FRED"
  };
}

function latestNumeric(points: FredPoint[]) {
  return points.at(-1) ?? null;
}

function previousPoint(points: FredPoint[], currentDate: string, periodsBack: number) {
  const index = points.findIndex((point) => point.date === currentDate);
  if (index < 0) return null;
  return points[Math.max(0, index - periodsBack)] ?? null;
}

function scoreMacro(metrics: MacroMetric[]) {
  const byId = metricMap(metrics);
  let score = 50;
  const cpi = byId.get("CPIAUCSL");
  const coreCpi = byId.get("CPILFESL");
  const vix = byId.get("VIXCLS");
  const sp500 = byId.get("SP500");
  const tenYear = byId.get("DGS10");
  const twoYear = byId.get("DGS2");
  const unemployment = byId.get("UNRATE");
  const fedFunds = byId.get("FEDFUNDS");

  if ((cpi?.change ?? 0) < 0) score += 8;
  if ((coreCpi?.change ?? 0) < 0) score += 10;
  if ((cpi?.change ?? 0) > 0.15) score -= 8;
  if ((coreCpi?.change ?? 0) > 0.15) score -= 10;
  if ((vix?.value ?? 99) < 18) score += 8;
  if ((vix?.value ?? 0) > 25) score -= 12;
  if ((sp500?.change ?? 0) > 1.5) score += 8;
  if ((sp500?.change ?? 0) < -1.5) score -= 8;
  if (tenYear?.value !== null && twoYear?.value !== null && tenYear && twoYear && tenYear.value < twoYear.value) score -= 6;
  if ((unemployment?.change ?? 0) > 0.2) score -= 6;
  if ((fedFunds?.change ?? 0) > 0.1) score -= 5;
  if ((fedFunds?.change ?? 0) < -0.1) score += 5;
  if ((tenYear?.change ?? 0) > 0.2) score -= 6;
  if ((tenYear?.change ?? 0) < -0.2) score += 4;

  return clamp(Math.round(score), 0, 100);
}

function buildDrivers(metrics: MacroMetric[], score: number, fedPolicy: FedPolicySnapshot | null) {
  const byId = metricMap(metrics);
  const drivers: string[] = [];
  const cpi = byId.get("CPIAUCSL");
  const coreCpi = byId.get("CPILFESL");
  const vix = byId.get("VIXCLS");
  const sp500 = byId.get("SP500");
  const tenYear = byId.get("DGS10");
  const twoYear = byId.get("DGS2");
  const fedFunds = byId.get("FEDFUNDS");

  if (fedPolicy) {
    drivers.push(fedPolicy.summary);
  } else if (fedFunds?.value !== null && fedFunds?.value !== undefined) {
    drivers.push(`実効FF金利は${formatValue(fedFunds)}で、前回比${formatSigned(fedFunds.change ?? 0)}ptです。`);
  }

  if (coreCpi?.change !== null && coreCpi?.change !== undefined) {
    drivers.push(`Core CPIは前回比${formatSigned(coreCpi.change)}ptで、インフレ圧力は${coreCpi.change <= 0 ? "やや低下" : "再加速気味"}です。`);
  }
  if (cpi?.change !== null && cpi?.change !== undefined) {
    drivers.push(`CPIは前年比${formatValue(cpi)}、変化幅${formatSigned(cpi.change)}ptです。`);
  }
  if (vix?.value !== null && vix?.value !== undefined) {
    drivers.push(`VIXは${vix.value.toFixed(1)}で、株式市場のストレスは${vix.value < 18 ? "低め" : vix.value > 25 ? "高め" : "中立"}です。`);
  }
  if (sp500?.change !== null && sp500?.change !== undefined) {
    drivers.push(`S&P 500の直近変化は${formatSigned(sp500.change)}%で、価格モメンタムは${sp500.change >= 0 ? "プラス" : "マイナス"}です。`);
  }
  if (tenYear?.value !== null && twoYear?.value !== null && tenYear && twoYear) {
    drivers.push(`10年-${"2"}年金利差は${(tenYear.value - twoYear.value).toFixed(2)}ptで、景気見通しの歪みを確認する局面です。`);
  }
  drivers.push(`総合マクロスコアは${score}/100です。`);
  return drivers.slice(0, 5);
}

function buildRisks(metrics: MacroMetric[]) {
  const byId = metricMap(metrics);
  const risks = [
    "CPIや雇用統計の公表直後は、金利と株価指数が同時に大きく振れやすいです。",
    "この分析は公開マクロ指標ベースで、個別銘柄の決算・IR・需給は別途確認が必要です。"
  ];
  const vix = byId.get("VIXCLS");
  const coreCpi = byId.get("CPILFESL");
  const fedFunds = byId.get("FEDFUNDS");
  if ((vix?.value ?? 0) > 25) risks.unshift("VIXが高く、短期の下振れ・ギャップリスクが残っています。");
  if ((coreCpi?.change ?? 0) > 0.15) risks.unshift("Core CPIが再加速気味で、利下げ期待の後退が株式の重しになります。");
  if ((fedFunds?.change ?? 0) > 0.1) risks.unshift("政策金利が上昇方向で、グロース株や高PER銘柄のバリュエーション圧力に注意が必要です。");
  return risks.slice(0, 4);
}

function buildRuleSummary(scenario: MacroMarketOutlook["scenario"], metrics: MacroMetric[]) {
  const byId = metricMap(metrics);
  const cpi = byId.get("CPIAUCSL");
  const core = byId.get("CPILFESL");
  const vix = byId.get("VIXCLS");
  const fedFunds = byId.get("FEDFUNDS");
  const direction = scenario === "risk_on" ? "リスクオン寄り" : scenario === "risk_off" ? "リスクオフ警戒" : "レンジ想定";
  return `米国市場は${direction}です。CPI ${formatValue(cpi)}、Core CPI ${formatValue(core)}、実効FF金利 ${formatValue(fedFunds)}、VIX ${formatValue(vix)}を中心に、金利と株価指数の反応を確認してください。`;
}

function buildFedPolicySnapshot(metrics: MacroMetric[]): FedPolicySnapshot | null {
  const byId = metricMap(metrics);
  const lower = byId.get("DFEDTARL");
  const upper = byId.get("DFEDTARU");
  const fedFunds = byId.get("FEDFUNDS");
  const lowerBound = lower?.value ?? null;
  const upperBound = upper?.value ?? null;
  const midpoint = lowerBound !== null && upperBound !== null ? (lowerBound + upperBound) / 2 : null;
  const effectiveRate = fedFunds?.value ?? null;
  if (midpoint === null && effectiveRate === null) return null;

  const monthlyChange = fedFunds?.change ?? null;
  const stance: FedPolicySnapshot["stance"] = monthlyChange !== null && monthlyChange > 0.1
    ? "tightening"
    : monthlyChange !== null && monthlyChange < -0.1
      ? "easing"
      : "neutral";
  const rangeLabel = lowerBound !== null && upperBound !== null
    ? `${lowerBound.toFixed(2)}-${upperBound.toFixed(2)}%`
    : "未取得";
  const stanceLabel = stance === "tightening" ? "引き締め方向" : stance === "easing" ? "緩和方向" : "据え置き/中立";

  return {
    lowerBound,
    upperBound,
    midpoint,
    effectiveRate,
    monthlyChange,
    stance,
    date: upper?.date ?? lower?.date ?? fedFunds?.date ?? "",
    summary: `FOMC政策金利レンジは${rangeLabel}、実効FF金利は${effectiveRate !== null ? `${effectiveRate.toFixed(2)}%` : "未取得"}で、政策スタンスは${stanceLabel}です。`
  };
}

function metricMap(metrics: MacroMetric[]) {
  return new Map(metrics.map((metric) => [metric.id, metric]));
}

function formatValue(metric?: MacroMetric) {
  if (!metric || metric.value === null) return "-";
  return `${metric.value.toFixed(metric.value >= 100 ? 0 : 2)}${metric.unit}`;
}

function formatSigned(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
