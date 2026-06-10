export type SpotAccountType = "taxable" | "general" | "nisa";
export type SpotCurrency = "USD" | "JPY";

export type SpotSimulationInput = {
  currency: SpotCurrency;
  shares: number;
  entryPrice: number;
  takeProfitPercent: number;
  stopLossPercent: number;
  accountType: SpotAccountType;
  feeJpy: number;
  fxRate: number;
  taxRate?: number;
};

export type SpotScenario = {
  label: string;
  percent: number;
  price: number;
  grossPnlNative: number;
  grossPnlJpy: number;
  taxJpy: number;
  netPnlJpy: number;
  returnPercentAfterTax: number;
  status: "利確ライン" | "損切りライン" | "利益" | "損失" | "建値";
};

export type SpotSimulationSummary = {
  currency: SpotCurrency;
  accountType: SpotAccountType;
  taxRate: number;
  shares: number;
  entryPrice: number;
  positionValueNative: number;
  positionValueJpy: number;
  feeJpy: number;
  fxRate: number;
  takeProfit: SpotScenario;
  stopLoss: SpotScenario;
  maxLoss: SpotScenario;
  riskReward: number | null;
  scenarios: SpotScenario[];
};

export const JAPAN_CAPITAL_GAINS_TAX_RATE = 0.20315;

export function accountTypeLabel(accountType: SpotAccountType) {
  if (accountType === "nisa") return "NISA";
  if (accountType === "general") return "一般口座";
  return "特定口座";
}

export function calculateSpotTax(profitJpy: number, accountType: SpotAccountType, taxRate = JAPAN_CAPITAL_GAINS_TAX_RATE) {
  if (accountType === "nisa") return 0;
  return Math.max(profitJpy, 0) * taxRate;
}

export function calculateSpotSimulation(input: SpotSimulationInput): SpotSimulationSummary {
  const sanitized = sanitizeInput(input);
  const positionValueNative = sanitized.shares * sanitized.entryPrice;
  const positionValueJpy = toJpy(positionValueNative, sanitized.currency, sanitized.fxRate);
  const percentages = buildScenarioPercentages(sanitized.takeProfitPercent, sanitized.stopLossPercent);
  const scenarios = percentages.map((percent) => calculateSpotScenario(sanitized, percent, positionValueJpy));
  const takeProfit = findOrBuildScenario(sanitized, sanitized.takeProfitPercent, positionValueJpy, scenarios);
  const stopLoss = findOrBuildScenario(sanitized, sanitized.stopLossPercent, positionValueJpy, scenarios);
  const maxLoss = scenarios.reduce((worst, scenario) => scenario.netPnlJpy < worst.netPnlJpy ? scenario : worst, scenarios[0] ?? stopLoss);
  const riskReward = Math.abs(stopLoss.netPnlJpy) > 0 ? Math.max(takeProfit.netPnlJpy, 0) / Math.abs(stopLoss.netPnlJpy) : null;

  return {
    currency: sanitized.currency,
    accountType: sanitized.accountType,
    taxRate: sanitized.taxRate,
    shares: sanitized.shares,
    entryPrice: sanitized.entryPrice,
    positionValueNative,
    positionValueJpy,
    feeJpy: sanitized.feeJpy,
    fxRate: sanitized.fxRate,
    takeProfit,
    stopLoss,
    maxLoss,
    riskReward,
    scenarios
  };
}

function sanitizeInput(input: SpotSimulationInput) {
  const currency: SpotCurrency = input.currency === "JPY" ? "JPY" : "USD";
  return {
    currency,
    shares: Math.max(finiteOr(input.shares, 0), 0),
    entryPrice: Math.max(finiteOr(input.entryPrice, 0), 0),
    takeProfitPercent: finiteOr(input.takeProfitPercent, 10),
    stopLossPercent: finiteOr(input.stopLossPercent, -8),
    accountType: input.accountType,
    feeJpy: Math.max(finiteOr(input.feeJpy, 0), 0),
    fxRate: currency === "JPY" ? 1 : Math.max(finiteOr(input.fxRate, 150), 0),
    taxRate: Math.max(finiteOr(input.taxRate ?? JAPAN_CAPITAL_GAINS_TAX_RATE, JAPAN_CAPITAL_GAINS_TAX_RATE), 0)
  };
}

function calculateSpotScenario(
  input: ReturnType<typeof sanitizeInput>,
  percent: number,
  positionValueJpy: number
): SpotScenario {
  const price = input.entryPrice * (1 + percent / 100);
  const grossPnlNative = (price - input.entryPrice) * input.shares;
  const grossPnlJpy = toJpy(grossPnlNative, input.currency, input.fxRate);
  const taxJpy = calculateSpotTax(grossPnlJpy - input.feeJpy, input.accountType, input.taxRate);
  const netPnlJpy = grossPnlJpy - input.feeJpy - taxJpy;
  const returnPercentAfterTax = positionValueJpy > 0 ? netPnlJpy / positionValueJpy * 100 : 0;

  return {
    label: scenarioLabel(percent, input.takeProfitPercent, input.stopLossPercent),
    percent,
    price,
    grossPnlNative,
    grossPnlJpy,
    taxJpy,
    netPnlJpy,
    returnPercentAfterTax,
    status: scenarioStatus(percent, input.takeProfitPercent, input.stopLossPercent)
  };
}

function findOrBuildScenario(
  input: ReturnType<typeof sanitizeInput>,
  percent: number,
  positionValueJpy: number,
  scenarios: SpotScenario[]
) {
  return scenarios.find((scenario) => scenario.percent === roundPercent(percent)) ?? calculateSpotScenario(input, percent, positionValueJpy);
}

function buildScenarioPercentages(takeProfitPercent: number, stopLossPercent: number) {
  return Array.from(new Set([-20, -10, stopLossPercent, -5, 0, 5, 10, takeProfitPercent, 20].map(roundPercent)))
    .sort((a, b) => a - b);
}

function scenarioLabel(percent: number, takeProfitPercent: number, stopLossPercent: number) {
  if (roundPercent(percent) === roundPercent(takeProfitPercent)) return `利確 ${formatSignedPercent(percent)}`;
  if (roundPercent(percent) === roundPercent(stopLossPercent)) return `損切り ${formatSignedPercent(percent)}`;
  if (percent === 0) return "建値";
  return formatSignedPercent(percent);
}

function scenarioStatus(percent: number, takeProfitPercent: number, stopLossPercent: number): SpotScenario["status"] {
  if (roundPercent(percent) === roundPercent(takeProfitPercent)) return "利確ライン";
  if (roundPercent(percent) === roundPercent(stopLossPercent)) return "損切りライン";
  if (percent > 0) return "利益";
  if (percent < 0) return "損失";
  return "建値";
}

function toJpy(value: number, currency: SpotCurrency, fxRate: number) {
  return currency === "JPY" ? value : value * fxRate;
}

function finiteOr(value: number, fallback: number) {
  return Number.isFinite(value) ? value : fallback;
}

function roundPercent(value: number) {
  return Math.round(value * 100) / 100;
}

function formatSignedPercent(value: number) {
  return `${value > 0 ? "+" : ""}${roundPercent(value)}%`;
}
