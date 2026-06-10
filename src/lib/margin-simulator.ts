export type MarginInputs = {
  collateral: number;
  buyPrice: number;
  unit: number;
  marginRate: number;
  targetPrice: number;
  maintenanceRate: number;
  dangerRate: number;
  taxRate: number;
  interestRate: number;
  holdingDays: number;
  fee: number;
  stopLossPrice: number;
  expiryDays: number;
};

export type MarginSummary = {
  maxShares: number;
  positionValue: number;
  requiredMargin: number;
  afterEntryCash: number;
  yenPerMove: number;
  targetGrossProfit: number;
  interestCost: number;
  taxCost: number;
  targetNetProfit: number;
  marginCallPrice: number;
  dangerPrice: number;
  stopLossPnl: number;
  expiryInterestCost: number;
  expiryTargetNetProfit: number;
  expiryMarginCallPrice: number;
};

export type MarginScenario = {
  price: number;
  unrealizedPnl: number;
  interestCost: number;
  taxCost: number;
  netPnl: number;
  marginRatio: number;
  status: "通常" | "利確候補" | "追証候補" | "10%割れ候補";
  marginShortfall: number;
};

export type PositionComparison = {
  shares: number;
  positionValue: number;
  requiredMargin: number;
  afterEntryCash: number;
  targetGrossProfit: number;
  interestCost: number;
  targetNetProfit: number;
  marginCallPrice: number;
  yenPerMove: number;
  riskLabel: "余裕あり" | "中間" | "攻め" | "かなり攻め";
};

export const defaultMarginInputs: MarginInputs = {
  collateral: 1_500_000,
  buyPrice: 345,
  unit: 100,
  marginRate: 0.3,
  targetPrice: 365,
  maintenanceRate: 0.2,
  dangerRate: 0.1,
  taxRate: 0.20315,
  interestRate: 0.028,
  holdingDays: 30,
  fee: 0,
  stopLossPrice: 330,
  expiryDays: 180
};

function floorToUnit(value: number, unit: number) {
  if (unit <= 0) return 0;
  return Math.max(Math.floor(value / unit) * unit, 0);
}

function interest(positionValue: number, annualRate: number, days: number) {
  return positionValue * annualRate * days / 365;
}

function taxOnProfit(profit: number, taxRate: number) {
  return Math.max(profit, 0) * taxRate;
}

function marginLinePrice(inputs: MarginInputs, shares: number, positionValue: number, interestCost: number, rate: number) {
  if (shares <= 0) return 0;
  return inputs.buyPrice + ((positionValue * rate) - inputs.collateral + interestCost) / shares;
}

export function calculateMarginSummary(inputs: MarginInputs): MarginSummary {
  const buyingCapacity = inputs.marginRate > 0 ? inputs.collateral / inputs.marginRate : 0;
  const maxShares = floorToUnit(buyingCapacity / inputs.buyPrice, inputs.unit);
  const positionValue = maxShares * inputs.buyPrice;
  const requiredMargin = positionValue * inputs.marginRate;
  const afterEntryCash = inputs.collateral - requiredMargin;
  const targetGrossProfit = (inputs.targetPrice - inputs.buyPrice) * maxShares;
  const interestCost = interest(positionValue, inputs.interestRate, inputs.holdingDays);
  const taxableProfit = targetGrossProfit - interestCost - inputs.fee;
  const taxCost = taxOnProfit(taxableProfit, inputs.taxRate);
  const targetNetProfit = targetGrossProfit - interestCost - inputs.fee - taxCost;
  const marginCallPrice = marginLinePrice(inputs, maxShares, positionValue, interestCost, inputs.maintenanceRate);
  const dangerPrice = marginLinePrice(inputs, maxShares, positionValue, interestCost, inputs.dangerRate);
  const stopLossPnl = (inputs.stopLossPrice - inputs.buyPrice) * maxShares - interestCost - inputs.fee;
  const expiryInterestCost = interest(positionValue, inputs.interestRate, inputs.expiryDays);
  const expiryTax = taxOnProfit(targetGrossProfit - expiryInterestCost - inputs.fee, inputs.taxRate);
  const expiryTargetNetProfit = targetGrossProfit - expiryInterestCost - inputs.fee - expiryTax;
  const expiryMarginCallPrice = marginLinePrice(inputs, maxShares, positionValue, expiryInterestCost, inputs.maintenanceRate);

  return {
    maxShares,
    positionValue,
    requiredMargin,
    afterEntryCash,
    yenPerMove: maxShares,
    targetGrossProfit,
    interestCost,
    taxCost,
    targetNetProfit,
    marginCallPrice,
    dangerPrice,
    stopLossPnl,
    expiryInterestCost,
    expiryTargetNetProfit,
    expiryMarginCallPrice
  };
}

export function calculateScenario(inputs: MarginInputs, price: number): MarginScenario {
  const summary = calculateMarginSummary(inputs);
  const unrealizedPnl = (price - inputs.buyPrice) * summary.maxShares;
  const taxableProfit = unrealizedPnl - summary.interestCost - inputs.fee;
  const taxCost = taxOnProfit(taxableProfit, inputs.taxRate);
  const netPnl = unrealizedPnl - summary.interestCost - taxCost - inputs.fee;
  const marginRatio = summary.positionValue > 0
    ? (inputs.collateral + unrealizedPnl - summary.interestCost) / summary.positionValue
    : 0;
  const status = marginRatio < inputs.dangerRate
    ? "10%割れ候補"
    : marginRatio < inputs.maintenanceRate
      ? "追証候補"
      : price >= inputs.targetPrice
        ? "利確候補"
        : "通常";
  const marginShortfall = Math.max(summary.positionValue * inputs.maintenanceRate - (inputs.collateral + unrealizedPnl - summary.interestCost), 0);

  return {
    price,
    unrealizedPnl,
    interestCost: summary.interestCost,
    taxCost,
    netPnl,
    marginRatio,
    status,
    marginShortfall
  };
}

export function buildScenarios(inputs: MarginInputs) {
  const start = floorToUnit(Math.max(inputs.buyPrice - 45, inputs.dangerRate > 0 ? calculateMarginSummary(inputs).dangerPrice - 15 : 0), 5);
  const end = Math.ceil((Math.max(inputs.targetPrice + 115, inputs.buyPrice + 60) / 5)) * 5;
  const scenarios: MarginScenario[] = [];
  for (let price = start; price <= end; price += 5) {
    scenarios.push(calculateScenario(inputs, price));
  }
  return scenarios;
}

export function buildPositionComparisons(inputs: MarginInputs) {
  const summary = calculateMarginSummary(inputs);
  const candidates = [5000, 10000, 12000, 15000, floorToUnit(summary.maxShares * 0.5, inputs.unit), floorToUnit(summary.maxShares * 0.75, inputs.unit), summary.maxShares];
  const uniqueShares = Array.from(new Set(candidates.filter((shares) => shares > 0))).sort((a, b) => a - b);

  return uniqueShares.map((shares): PositionComparison => {
    const positionValue = shares * inputs.buyPrice;
    const requiredMargin = positionValue * inputs.marginRate;
    const afterEntryCash = inputs.collateral - requiredMargin;
    const targetGrossProfit = (inputs.targetPrice - inputs.buyPrice) * shares;
    const interestCost = interest(positionValue, inputs.interestRate, inputs.holdingDays);
    const targetNetProfit = targetGrossProfit - interestCost - taxOnProfit(targetGrossProfit - interestCost, inputs.taxRate);
    const marginCallPrice = marginLinePrice(inputs, shares, positionValue, interestCost, inputs.maintenanceRate);
    const riskLabel = afterEntryCash < 50_000 ? "かなり攻め" : afterEntryCash < 200_000 ? "攻め" : afterEntryCash < 500_000 ? "中間" : "余裕あり";

    return {
      shares,
      positionValue,
      requiredMargin,
      afterEntryCash,
      targetGrossProfit,
      interestCost,
      targetNetProfit,
      marginCallPrice,
      yenPerMove: shares,
      riskLabel
    };
  });
}
