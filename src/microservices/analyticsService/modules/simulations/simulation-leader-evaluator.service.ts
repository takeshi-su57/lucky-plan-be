import { Injectable } from '@nestjs/common';
import dayjs from 'dayjs';

import { Simulation } from 'src/microservices/apiService/modules/simulations/entities/simulations.entity';

import { PnlSnapshotFileCacheService } from 'src/microservices/apiService/modules/trade-histories/pnl-snapshot-file-cache.service';
import { getWeb3Info } from 'src/web3/utils';
import { BotMode, Platform } from 'generated/prisma/enums';
import {
  PerpTradeHistory,
  PerpTradeHistoryOperation,
  PerpTradePosition,
} from 'src/microservices/apiService/modules/trade-histories/entities/event-logs.entity';
import {
  calculateMaxDrawdown,
  calculateProfitFactor,
  calculateTrend,
  cumulative,
  getScoreFormular,
  getSizingFormular,
  getPositionPnls,
  sum,
} from './utils/simulation-automation.utils';
import { SIMULATION_SYSTEM_CONFIG } from './simulation.constants';
import { WindowRange } from './utils/simulation-range.utils';
import { getEventLogStableId } from 'src/microservices/apiService/modules/trade-histories/event-log-identity.utils';

type ValueRange = {
  min: number;
  max: number;
};

const BOT_TRADER_MIN_AVG_DURATION_MS = 10 * 60 * 1000;

function getDirectionalSlopeRange(direction: BotMode, range: ValueRange) {
  const minSlope = Math.abs(range.min);
  const maxSlope = Math.abs(range.max);

  if (direction === BotMode.Reversed) {
    return {
      min: -maxSlope,
      max: -minSlope,
    };
  }

  return {
    min: minSlope,
    max: maxSlope,
  };
}

function valueMatchesRange(value: number, range: ValueRange) {
  return value >= range.min && value <= range.max;
}

function valueMatchesAnyRange(value: number, ranges: ValueRange[]) {
  return ranges.some((range) => valueMatchesRange(value, range));
}

export type CandidateEvaluation = {
  leaderAddress: string;
  score: number;
  suggestedRatio: number;
  suggestedCollateralUsd: number;
  rawTotalPnlUsd: number;
  rawSlope: number;
  rawR2: number;
  rawTradeCount: number;
  copiedNetPnlUsd: number;
  copiedDrawdownUsd: number;
  copiedProfitFactor: number;
  rejectedReason?: string;
};

export type ContractContext = {
  id: number;
  chainId: number;
  address: string;
  version: any;
  platform: Platform;
};

type CopySimulationResult = {
  grossPnlUsd: number;
  netPnlUsd: number;
  totalCostUsd: number;
  maxDrawdownUsd: number;
  slope: number;
  r2: number;
  profitFactor: number;
  grossProfitUsd: number;
  topTradeProfitUsd: number;
};

const PLATFORM_MIN_FEE_USD = 0.5;

@Injectable()
export class SimulationLeaderEvaluatorService {
  constructor(
    private readonly pnlSnapshotFileCacheService: PnlSnapshotFileCacheService,
  ) {}

  async findCandidateLeaders(simulation: Simulation, range: WindowRange) {
    const dateStr = dayjs(range.startedAt).format('YYYY-MM-DD');
    const records = await this.pnlSnapshotFileCacheService.readAllByAddress(
      simulation.platform,
      dateStr,
    );
    if (!records) return [];
    return records
      .filter((record) =>
        simulation.direction === BotMode.Default
          ? record.accUSDPnl >= 50
          : record.accUSDPnl <= -50,
      )
      .sort(
        (left, right) =>
          left.accUSDPnl - right.accUSDPnl ||
          left.address.localeCompare(right.address),
      )
      .map((record) => record.address);
  }

  static evaluateLeaderPositionsForSimulation(
    leaderAddress: string,
    closedPositions: PerpTradePosition[],
    simulation: Simulation,
  ): CandidateEvaluation {
    const rawPositionPnls = getPositionPnls(
      closedPositions,
      (history) => history.usdPnl,
    );
    const rawTradeCount = rawPositionPnls.length;
    const rawTotalPnlUsd = sum(rawPositionPnls);
    const rawTrend = calculateTrend(cumulative(rawPositionPnls));
    const rawAvgCollateralUsd =
      SimulationLeaderEvaluatorService.calculateAverageMaxDepositedUsd(
        closedPositions,
      );

    const baseEvaluation = {
      leaderAddress,
      score: 0,
      suggestedRatio: 0,
      suggestedCollateralUsd: 0,
      rawTotalPnlUsd,
      rawSlope: rawTrend.slope,
      rawR2: rawTrend.r2,
      rawTradeCount,
      copiedNetPnlUsd: 0,
      copiedDrawdownUsd: 0,
      copiedProfitFactor: 0,
    };
    const effectiveSlopeRanges = simulation.slope.map((range) =>
      getDirectionalSlopeRange(simulation.direction, range),
    );

    if (!valueMatchesAnyRange(rawTradeCount, simulation.trade)) {
      return { ...baseEvaluation, rejectedReason: 'TRADE_COUNT_OUT_OF_RANGE' };
    }

    const rawAvgDurationMs =
      SimulationLeaderEvaluatorService.calculateAveragePositionDurationMs(
        closedPositions,
      );

    if (
      rawAvgDurationMs !== null &&
      rawAvgDurationMs < BOT_TRADER_MIN_AVG_DURATION_MS
    ) {
      return {
        ...baseEvaluation,
        rejectedReason: 'BOT_TRADER_AVG_DURATION_TOO_SHORT',
      };
    }

    if (!valueMatchesAnyRange(rawTrend.slope, effectiveSlopeRanges)) {
      return { ...baseEvaluation, rejectedReason: 'SLOPE_OUT_OF_RANGE' };
    }

    if (!valueMatchesAnyRange(rawTrend.r2, simulation.r2)) {
      return { ...baseEvaluation, rejectedReason: 'R2_OUT_OF_RANGE' };
    }

    if (rawAvgCollateralUsd < SIMULATION_SYSTEM_CONFIG.minCollateralUsd) {
      return { ...baseEvaluation, rejectedReason: 'LOW_AVG_COLLATERAL' };
    }

    const preliminaryCopy =
      SimulationLeaderEvaluatorService.simulateCopyApproximation(
        closedPositions,
        1,
        simulation.direction,
      );
    const preliminaryScore = SimulationLeaderEvaluatorService.scoreCandidate(
      simulation,
      rawTrend,
      rawTradeCount,
      preliminaryCopy,
    );
    const sizing = getSizingFormular(simulation.sizingFormular)({
      score: preliminaryScore,
      standardCollateralUsd: simulation.standardCollateralUsd,
      minCollateralUsd: SIMULATION_SYSTEM_CONFIG.minCollateralUsd,
      maxCollateralUsd: SIMULATION_SYSTEM_CONFIG.maxCollateralUsd,
      leaderAvgCollateralUsd: rawAvgCollateralUsd,
      minRatio: SIMULATION_SYSTEM_CONFIG.minRatio,
      maxRatio: SIMULATION_SYSTEM_CONFIG.maxRatio,
    });
    const copied = SimulationLeaderEvaluatorService.simulateCopyApproximation(
      closedPositions,
      sizing.suggestedRatio,
      simulation.direction,
    );

    return {
      ...baseEvaluation,
      score: preliminaryScore,
      suggestedRatio: sizing.suggestedRatio,
      suggestedCollateralUsd: sizing.suggestedCollateralUsd,
      copiedNetPnlUsd: copied.netPnlUsd,
      copiedDrawdownUsd: copied.maxDrawdownUsd,
      copiedProfitFactor: copied.profitFactor,
    };
  }

  static getClosedPositionsBefore(
    positions: PerpTradePosition[],
    before: Date,
  ) {
    const beforeTime = before.getTime();

    return positions.filter((position) => {
      if (!SimulationLeaderEvaluatorService.isClosedPosition(position)) {
        return false;
      }

      const closedAt = position.histories[position.histories.length - 1]?.date;

      return closedAt ? new Date(closedAt).getTime() < beforeTime : false;
    });
  }

  private static scoreCandidate(
    simulation: Simulation,
    rawTrend: { slope: number; r2: number },
    rawTradeCount: number,
    copied: CopySimulationResult,
  ) {
    return getScoreFormular(simulation.scoreFormular)({
      direction: simulation.direction,
      rawSlope: rawTrend.slope,
      rawR2: rawTrend.r2,
      rawTradeCount,
      copiedNetPnlUsd: copied.netPnlUsd,
      copiedSlope: copied.slope,
      copiedR2: copied.r2,
      copiedMaxDrawdownUsd: copied.maxDrawdownUsd,
      copiedProfitFactor: copied.profitFactor,
      totalCostUsd: copied.totalCostUsd,
      grossProfitUsd: copied.grossProfitUsd,
      topTradeProfitUsd: copied.topTradeProfitUsd,
      minTrades: Math.min(...simulation.trade.map((range) => range.min)),
      maxCopiedDrawdownUsd: SIMULATION_SYSTEM_CONFIG.maxCollateralUsd,
    });
  }

  static eventLogsToHistories(
    records: {
      date: Date;
      block: number;
      logIndex: number;
      contractId: number;
      platform: Platform;
      jsonLog: string;
    }[],
    contractById: Map<number, ContractContext>,
  ) {
    return records
      .map((record) => {
        const contract = contractById.get(record.contractId);

        if (!contract) {
          return null;
        }

        const history = getWeb3Info(
          contract.platform,
          contract.version,
        ).eventToPerpTradeHistory(
          contract.chainId,
          JSON.parse(record.jsonLog) as any,
          contract.address,
        );

        return history
          ? {
              ...history,
              id: getEventLogStableId(record),
              date: record.date,
              chainId: contract.chainId,
              contractId: record.contractId,
              platform: record.platform,
            }
          : null;
      })
      .filter((item): item is PerpTradeHistory => !!item);
  }

  private static isClosedPosition(position: PerpTradePosition) {
    return (
      position.histories[position.histories.length - 1]?.operation ===
      PerpTradeHistoryOperation.CLOSE
    );
  }

  private static calculatePositionMaxDepositedUsd(position: PerpTradePosition) {
    return Math.max(
      0,
      ...position.histories.map((history) => history.collateralInUsd || 0),
    );
  }

  private static calculateAverageMaxDepositedUsd(
    positions: PerpTradePosition[],
  ) {
    if (positions.length === 0) {
      return 0;
    }

    return (
      sum(
        positions.map((position) =>
          SimulationLeaderEvaluatorService.calculatePositionMaxDepositedUsd(
            position,
          ),
        ),
      ) / positions.length
    );
  }

  private static calculateAveragePositionDurationMs(
    positions: PerpTradePosition[],
  ): number | null {
    const durations = positions
      .map((position) => {
        const timestamps = position.histories
          .map((history) => history.date?.getTime())
          .filter((timestamp): timestamp is number => timestamp !== undefined);

        if (timestamps.length < 2) {
          return null;
        }

        return Math.max(...timestamps) - Math.min(...timestamps);
      })
      .filter((duration): duration is number => duration !== null);

    if (durations.length === 0) {
      return null;
    }

    return sum(durations) / durations.length;
  }

  private static simulateCopyApproximation(
    positions: PerpTradePosition[],
    ratio: number,
    direction: Simulation['direction'],
  ): CopySimulationResult {
    const directionMultiplier = direction === 'Reversed' ? -1 : 1;
    let totalCostUsd = 0;
    const grossPositionPnls = positions.map((position) => {
      const copiedPnl = sum(
        position.histories.map((history) => {
          const copiedFee =
            SimulationLeaderEvaluatorService.calculateCopiedPlatformFee(
              history.usdFee,
              ratio,
            );
          totalCostUsd += Math.abs(copiedFee);

          return (
            (history.usdPnl - history.usdFee) * ratio * directionMultiplier +
            copiedFee
          );
        }),
      );
      const maxLoss =
        -Math.abs(
          SimulationLeaderEvaluatorService.calculatePositionMaxDepositedUsd(
            position,
          ),
        ) * ratio;

      return Math.max(maxLoss, copiedPnl);
    });
    const netPositionPnls = grossPositionPnls;
    const equityCurve = cumulative(netPositionPnls);
    const trend = calculateTrend(equityCurve);
    const grossProfitUsd = sum(grossPositionPnls.filter((item) => item > 0));

    return {
      grossPnlUsd: sum(grossPositionPnls),
      netPnlUsd: sum(netPositionPnls),
      totalCostUsd,
      maxDrawdownUsd: calculateMaxDrawdown(equityCurve),
      slope: trend.slope,
      r2: trend.r2,
      profitFactor: calculateProfitFactor(netPositionPnls),
      grossProfitUsd,
      topTradeProfitUsd: Math.max(0, ...grossPositionPnls),
    };
  }

  private static calculateCopiedPlatformFee(usdFee: number, ratio: number) {
    if (usdFee === 0) {
      return 0;
    }

    return Math.min(-PLATFORM_MIN_FEE_USD, usdFee * ratio);
  }
}
