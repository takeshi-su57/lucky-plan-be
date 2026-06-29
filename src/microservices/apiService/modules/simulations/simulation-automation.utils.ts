import {
  PerpTradeHistory,
  PerpTradeHistoryOperation,
  PerpTradePosition,
} from '../trade-histories/entities/event-logs.entity';
import { BotMode } from 'generated/prisma/enums';

export type TrendMetrics = {
  slope: number;
  r2: number;
};

export type CostModelInput = {
  positions: PerpTradePosition[];
  ratio: number;
  openFeeRate: number;
  closeFeeRate: number;
  slippageRate: number;
};

export type CostModelResult = {
  openFeeUsd: number;
  closeFeeUsd: number;
  slippageUsd: number;
  totalCostUsd: number;
};

export type ScoreInput = {
  direction: BotMode;
  rawSlope: number;
  rawR2: number;
  rawTradeCount: number;
  copiedNetPnlUsd: number;
  copiedSlope: number;
  copiedR2: number;
  copiedMaxDrawdownUsd: number;
  copiedProfitFactor: number;
  totalCostUsd: number;
  grossProfitUsd: number;
  topTradeProfitUsd: number;
  minTrades: number;
  maxReverseDrawdownUsd: number;
};

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function clamp01(value: number) {
  return clamp(value, 0, 1);
}

export function sum(values: number[]) {
  return values.reduce((acc, value) => acc + value, 0);
}

export function calculateTrend(values: number[]): TrendMetrics {
  if (values.length < 2) {
    return { slope: 0, r2: 0 };
  }

  const n = values.length;
  const xs = values.map((_value, index) => index);
  const avgX = sum(xs) / n;
  const avgY = sum(values) / n;

  const covariance = sum(
    xs.map((x, index) => (x - avgX) * (values[index] - avgY)),
  );
  const varianceX = sum(xs.map((x) => (x - avgX) ** 2));

  if (varianceX === 0) {
    return { slope: 0, r2: 0 };
  }

  const slope = covariance / varianceX;
  const intercept = avgY - slope * avgX;
  const totalSumSquares = sum(values.map((value) => (value - avgY) ** 2));
  const residualSumSquares = sum(
    values.map((value, index) => {
      const predicted = slope * index + intercept;
      return (value - predicted) ** 2;
    }),
  );

  const r2 =
    totalSumSquares === 0
      ? 0
      : clamp01(1 - residualSumSquares / totalSumSquares);

  return { slope, r2 };
}

export function cumulative(values: number[]) {
  let total = 0;
  return values.map((value) => {
    total += value;
    return total;
  });
}

export function calculateMaxDrawdown(values: number[]) {
  let peak = 0;
  let maxDrawdown = 0;

  for (const value of values) {
    peak = Math.max(peak, value);
    maxDrawdown = Math.max(maxDrawdown, peak - value);
  }

  return maxDrawdown;
}

export function calculateProfitFactor(positionPnls: number[]) {
  const grossProfit = sum(positionPnls.filter((value) => value > 0));
  const grossLoss = Math.abs(sum(positionPnls.filter((value) => value < 0)));

  if (grossProfit === 0) {
    return 0;
  }

  if (grossLoss === 0) {
    return grossProfit;
  }

  return grossProfit / grossLoss;
}

export function getPositionPnls(
  positions: PerpTradePosition[],
  getHistoryPnl: (history: PerpTradeHistory) => number,
) {
  return positions.map((position) =>
    sum(position.histories.map((history) => getHistoryPnl(history))),
  );
}

export function calculateCosts({
  positions,
  ratio,
  openFeeRate,
  closeFeeRate,
  slippageRate,
}: CostModelInput): CostModelResult {
  let openNotionalUsd = 0;
  let closeNotionalUsd = 0;
  let tradedNotionalUsd = 0;

  for (const history of positions.flatMap((position) => position.histories)) {
    const sizeDeltaUsd = Math.abs(
      history.sizeDeltaUsd || history.sizeInUsd || 0,
    );
    const notionalUsd = sizeDeltaUsd * ratio;

    tradedNotionalUsd += notionalUsd;

    if (history.operation === PerpTradeHistoryOperation.OPEN) {
      openNotionalUsd += notionalUsd;
    }

    if (history.operation === PerpTradeHistoryOperation.CLOSE) {
      closeNotionalUsd += notionalUsd;
    }
  }

  const openFeeUsd = openNotionalUsd * openFeeRate;
  const closeFeeUsd = closeNotionalUsd * closeFeeRate;
  const slippageUsd = tradedNotionalUsd * slippageRate;

  return {
    openFeeUsd,
    closeFeeUsd,
    slippageUsd,
    totalCostUsd: openFeeUsd + closeFeeUsd + slippageUsd,
  };
}

export function calculateLeaderScore(input: ScoreInput) {
  const positiveNetPnlScore = clamp01(input.copiedNetPnlUsd / 1_000);
  const positiveSlopeScore =
    input.copiedSlope > 0 ? clamp01(input.copiedSlope / 100) : 0;
  const reverseTrendScore = clamp01(
    positiveNetPnlScore * 0.5 + positiveSlopeScore * 0.3 + input.copiedR2 * 0.2,
  );

  const alignedRawSlope =
    input.direction === BotMode.Reversed ? -input.rawSlope : input.rawSlope;
  const rawNegativeSlopeScore =
    alignedRawSlope > 0 ? clamp01(Math.abs(alignedRawSlope) / 100) : 0;
  const rawNegativeEdgeScore = clamp01(
    rawNegativeSlopeScore * 0.6 + input.rawR2 * 0.4,
  );

  const sampleScore = clamp01(
    input.rawTradeCount / Math.max(input.minTrades * 3, 1),
  );
  const drawdownScore =
    1 -
    clamp01(
      input.copiedMaxDrawdownUsd / Math.max(input.maxReverseDrawdownUsd, 1),
    );
  const profitFactorScore = clamp01((input.copiedProfitFactor - 1) / 2);
  const costEfficiencyScore =
    input.grossProfitUsd > 0
      ? clamp01(1 - input.totalCostUsd / input.grossProfitUsd)
      : 0;

  const concentrationPenalty =
    input.grossProfitUsd > 0
      ? 1 -
        clamp01(
          input.topTradeProfitUsd / Math.max(input.grossProfitUsd, 1) - 0.35,
        )
      : 1;

  const score =
    reverseTrendScore * 0.35 +
    rawNegativeEdgeScore * 0.2 +
    sampleScore * 0.15 +
    drawdownScore * 0.15 +
    profitFactorScore * 0.1 +
    costEfficiencyScore * 0.05;

  return clamp01(score) * concentrationPenalty;
}

export function suggestPositionSizing(params: {
  score: number;
  standardCollateralUsd: number;
  minCollateralUsd: number;
  maxCollateralUsd: number;
  leaderAvgCollateralUsd: number;
  minRatio: number;
  maxRatio: number;
}) {
  const suggestedCollateralUsd = clamp(
    params.standardCollateralUsd * params.score,
    params.minCollateralUsd,
    params.maxCollateralUsd,
  );
  const suggestedRatio = clamp(
    suggestedCollateralUsd / Math.max(params.leaderAvgCollateralUsd, 1),
    params.minRatio,
    params.maxRatio,
  );

  return {
    suggestedCollateralUsd,
    suggestedRatio,
  };
}
