import { Injectable, Logger } from '@nestjs/common';
import dayjs from 'dayjs';

import { Simulation } from './entities/simulations.entity';

import { PrismaService } from 'src/global/prisma.service';
import { EventLogsService } from '../trade-histories/event-logs.service';
import { getWeb3Info } from 'src/web3/utils';
import { Platform } from 'generated/prisma/enums';
import {
  PerpTradeHistory,
  PerpTradeHistoryOperation,
  PerpTradePosition,
} from '../trade-histories/entities/event-logs.entity';
import {
  calculateCosts,
  calculateLeaderScore,
  calculateMaxDrawdown,
  calculateProfitFactor,
  calculateTrend,
  cumulative,
  getPositionPnls,
  sum,
  suggestPositionSizing,
} from './simulation-automation.utils';
import { SIMULATION_SYSTEM_CONFIG } from './simulation.constants';
import { getRangeKey, WindowRange } from './simulation-range.utils';
import { getDirectionalSlopeBounds } from './simulation-research.utils';

export type CandidateEvaluation = {
  leaderAddress: string;
  score: number;
  suggestedRatio: number;
  suggestedCollateralUsd: number;
  rawTotalPnlUsd: number;
  rawSlope: number;
  rawR2: number;
  rawTradeCount: number;
  reverseNetPnlUsd: number;
  reverseDrawdownUsd: number;
  rejectedReason?: string;
};

export type ContractContext = {
  id: number;
  chainId: number;
  version: any;
  platform: Platform;
};

export type RangeEvaluationMap = Map<string, CandidateEvaluation[]>;
export type LeaderPositionsCache = Map<string, Promise<PerpTradePosition[]>>;

type ReverseSimulationResult = {
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

const CANDIDATE_PREFILTER_BATCH_SIZE = 50;
const CANDIDATE_RECENT_ACTIVITY_DAYS = 30;

@Injectable()
export class SimulationLeaderEvaluatorService {
  private readonly logger = new Logger(SimulationLeaderEvaluatorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventLogsService: EventLogsService,
  ) {}

  async findCandidateLeaders(
    simulation: Simulation,
    range: WindowRange,
    checkedLeaderAddresses: Set<string> = new Set(),
    shouldLog = true,
  ) {
    const dateStr = dayjs(range.startedAt).format('YYYY-MM-DD');
    const records = await this.prisma.pnlSnapshotV2.findMany({
      where: {
        platform: simulation.platform,
        dateStr,
        accUSDPnl: {
          lte: -50,
        },
      },
      select: {
        address: true,
      },
      orderBy: [{ accUSDPnl: 'asc' }, { address: 'asc' }],
    });

    const candidateAddresses = records.map((record) =>
      record.address.toLowerCase(),
    );
    const uncheckedCandidateAddresses = candidateAddresses.filter(
      (address) => !checkedLeaderAddresses.has(address),
    );

    const recentActivityCutoff = dayjs(range.startedAt)
      .subtract(CANDIDATE_RECENT_ACTIVITY_DAYS, 'day')
      .toDate();
    const prefilteredAddresses: string[] = [];
    let noRecentTradeHistoryCount = 0;
    let lowRecentTradeHistoryCount = 0;

    for (
      let offset = 0;
      offset < uncheckedCandidateAddresses.length;
      offset += CANDIDATE_PREFILTER_BATCH_SIZE
    ) {
      const addressBatch = uncheckedCandidateAddresses.slice(
        offset,
        offset + CANDIDATE_PREFILTER_BATCH_SIZE,
      );

      const activeLeaderGroups = await this.prisma.perpTradingEventLog.groupBy({
        by: ['address'],
        where: {
          platform: simulation.platform,
          address: {
            in: addressBatch,
          },
          date: {
            gte: recentActivityCutoff,
            lt: range.startedAt,
          },
        },
        _count: {
          address: true,
        },
      });
      const eventCountByAddress = new Map(
        activeLeaderGroups.map((group) => [
          group.address.toLowerCase(),
          group._count.address,
        ]),
      );

      addressBatch.forEach((address) => {
        // Cheap prefilter only: count recent raw trade-history events.
        // Position reconstruction and closed-position minTrades checks happen later.
        const recentTradeHistoryCount = eventCountByAddress.get(address) || 0;

        if (recentTradeHistoryCount === 0) {
          noRecentTradeHistoryCount += 1;
          return;
        }

        if (recentTradeHistoryCount < simulation.minTrades) {
          lowRecentTradeHistoryCount += 1;
          return;
        }

        prefilteredAddresses.push(address);
      });
    }

    if (shouldLog) {
      this.logDebug('Auto simulation candidates prefiltered', {
        simulationId: simulation.id,
        day: dateStr,
        snapshotCandidateCount: candidateAddresses.length,
        skippedAlreadyCheckedCount:
          candidateAddresses.length - uncheckedCandidateAddresses.length,
        prefilteredCount: prefilteredAddresses.length,
        noRecentTradeHistoryCount,
        lowRecentTradeHistoryCount,
      });
    }

    return prefilteredAddresses;
  }

  async evaluateLeadersAcrossRanges(
    simulation: Simulation,
    leaderAddresses: string[],
    ranges: WindowRange[],
    contractById: Map<number, ContractContext>,
    leaderPositionsCache: LeaderPositionsCache,
    selectedCandidatesByRangeKey: RangeEvaluationMap,
  ) {
    let evaluatedCount = 0;
    let acceptedCount = 0;

    for (const leaderAddress of leaderAddresses) {
      const positions = await this.getCachedLeaderPositions(
        leaderAddress,
        simulation,
        contractById,
        leaderPositionsCache,
      );

      for (const range of ranges) {
        evaluatedCount += 1;

        const evaluation = this.evaluateLeaderForReverseCopyFromPositions(
          leaderAddress,
          positions,
          simulation,
          range,
        );

        if (evaluation.rejectedReason || evaluation.score <= 0) {
          continue;
        }

        acceptedCount += 1;

        const rangeKey = getRangeKey(range);
        const rangeEvaluations =
          selectedCandidatesByRangeKey.get(rangeKey) || [];

        rangeEvaluations.push(evaluation);
        selectedCandidatesByRangeKey.set(rangeKey, rangeEvaluations);
      }
    }

    return { evaluatedCount, acceptedCount };
  }

  private logDebug(message: string, metadata?: Record<string, unknown>) {
    this.logger.debug(
      metadata ? `${message} ${JSON.stringify(metadata)}` : message,
    );
  }

  private async getCachedLeaderPositions(
    leaderAddress: string,
    simulation: Simulation,
    contractById: Map<number, ContractContext>,
    leaderPositionsCache: LeaderPositionsCache,
  ) {
    const normalizedLeaderAddress = leaderAddress.toLowerCase();
    const existing = leaderPositionsCache.get(normalizedLeaderAddress);

    if (existing) {
      return existing;
    }

    const pendingPositions = this.loadLeaderPositionsForSimulation(
      normalizedLeaderAddress,
      simulation,
      contractById,
    );

    leaderPositionsCache.set(normalizedLeaderAddress, pendingPositions);

    return pendingPositions;
  }

  private async loadLeaderPositionsForSimulation(
    leaderAddress: string,
    simulation: Simulation,
    contractById: Map<number, ContractContext>,
  ) {
    const records = await this.prisma.perpTradingEventLog.findMany({
      where: {
        address: leaderAddress.toLowerCase(),
        platform: simulation.platform,
        date: {
          lt: simulation.endAt,
        },
      },
      orderBy: [{ date: 'asc' }, { block: 'asc' }, { id: 'asc' }],
    });

    const histories = this.eventLogsToHistories(records, contractById);

    return this.eventLogsService.convertToPerpTradePositionsWithSummary(
      simulation.platform,
      histories,
      {
        maxLeverage: simulation.maxLeverage,
      },
    ).positions;
  }

  private evaluateLeaderForReverseCopyFromPositions(
    leaderAddress: string,
    positions: PerpTradePosition[],
    simulation: Simulation,
    range: WindowRange,
  ): CandidateEvaluation {
    return this.evaluateLeaderPositionsForSimulation(
      leaderAddress,
      this.getClosedPositionsBefore(positions, range.startedAt),
      simulation,
    );
  }

  private evaluateLeaderPositionsForSimulation(
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
      this.calculateAverageMaxDepositedUsd(closedPositions);

    const baseEvaluation = {
      leaderAddress,
      score: 0,
      suggestedRatio: 0,
      suggestedCollateralUsd: 0,
      rawTotalPnlUsd,
      rawSlope: rawTrend.slope,
      rawR2: rawTrend.r2,
      rawTradeCount,
      reverseNetPnlUsd: 0,
      reverseDrawdownUsd: 0,
    };
    const effectiveSlopeBounds = getDirectionalSlopeBounds(
      simulation.direction,
      {
        min: simulation.minSlope,
        max: simulation.maxSlope,
      },
    );

    if (
      rawTradeCount < simulation.minTrades ||
      rawTradeCount > simulation.maxTrades
    ) {
      return { ...baseEvaluation, rejectedReason: 'TRADE_COUNT_OUT_OF_RANGE' };
    }

    if (
      rawTrend.slope < effectiveSlopeBounds.minSlope ||
      rawTrend.slope > effectiveSlopeBounds.maxSlope
    ) {
      return { ...baseEvaluation, rejectedReason: 'SLOPE_OUT_OF_RANGE' };
    }

    if (rawTrend.r2 < simulation.minR2 || rawTrend.r2 > simulation.maxR2) {
      return { ...baseEvaluation, rejectedReason: 'R2_OUT_OF_RANGE' };
    }

    if (rawAvgCollateralUsd < SIMULATION_SYSTEM_CONFIG.minCollateralUsd) {
      return { ...baseEvaluation, rejectedReason: 'LOW_AVG_COLLATERAL' };
    }

    const preliminaryReverse = this.simulateCopyApproximation(
      closedPositions,
      1,
      simulation.direction,
    );
    const preliminaryScore = this.scoreCandidate(
      simulation,
      rawTrend,
      rawTradeCount,
      preliminaryReverse,
    );
    const sizing = suggestPositionSizing({
      score: preliminaryScore,
      standardCollateralUsd: simulation.standardCollateralUsd,
      minCollateralUsd: SIMULATION_SYSTEM_CONFIG.minCollateralUsd,
      maxCollateralUsd: SIMULATION_SYSTEM_CONFIG.maxCollateralUsd,
      leaderAvgCollateralUsd: rawAvgCollateralUsd,
      minRatio: SIMULATION_SYSTEM_CONFIG.minRatio,
      maxRatio: SIMULATION_SYSTEM_CONFIG.maxRatio,
    });
    const reverse = this.simulateCopyApproximation(
      closedPositions,
      sizing.suggestedRatio,
      simulation.direction,
    );
    const score = this.scoreCandidate(
      simulation,
      rawTrend,
      rawTradeCount,
      reverse,
    );

    return {
      ...baseEvaluation,
      score,
      suggestedRatio: sizing.suggestedRatio,
      suggestedCollateralUsd: sizing.suggestedCollateralUsd,
      reverseNetPnlUsd: reverse.netPnlUsd,
      reverseDrawdownUsd: reverse.maxDrawdownUsd,
    };
  }

  private getClosedPositionsBefore(
    positions: PerpTradePosition[],
    before: Date,
  ) {
    const beforeTime = before.getTime();

    return positions.filter((position) => {
      if (!this.isClosedPosition(position)) {
        return false;
      }

      const closedAt = position.histories[position.histories.length - 1]?.date;

      return closedAt ? new Date(closedAt).getTime() < beforeTime : false;
    });
  }

  private scoreCandidate(
    simulation: Simulation,
    rawTrend: { slope: number; r2: number },
    rawTradeCount: number,
    reverse: ReverseSimulationResult,
  ) {
    return calculateLeaderScore({
      direction: simulation.direction,
      rawSlope: rawTrend.slope,
      rawR2: rawTrend.r2,
      rawTradeCount,
      copiedNetPnlUsd: reverse.netPnlUsd,
      copiedSlope: reverse.slope,
      copiedR2: reverse.r2,
      copiedMaxDrawdownUsd: reverse.maxDrawdownUsd,
      copiedProfitFactor: reverse.profitFactor,
      totalCostUsd: reverse.totalCostUsd,
      grossProfitUsd: reverse.grossProfitUsd,
      topTradeProfitUsd: reverse.topTradeProfitUsd,
      minTrades: simulation.minTrades,
      maxReverseDrawdownUsd: SIMULATION_SYSTEM_CONFIG.maxCollateralUsd,
    });
  }

  private eventLogsToHistories(
    records: {
      id: number;
      date: Date;
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
        );

        return history
          ? {
              ...history,
              id: record.id,
              date: record.date,
              contractId: record.contractId,
              platform: record.platform,
            }
          : null;
      })
      .filter((item): item is PerpTradeHistory => !!item);
  }

  private isClosedPosition(position: PerpTradePosition) {
    return (
      position.histories[position.histories.length - 1]?.operation ===
      PerpTradeHistoryOperation.CLOSE
    );
  }

  private calculatePositionMaxDepositedUsd(position: PerpTradePosition) {
    return Math.max(
      0,
      ...position.histories.map((history) => history.collateralInUsd || 0),
    );
  }

  private calculatePositionCost(position: PerpTradePosition, ratio: number) {
    const costs = calculateCosts({
      positions: [position],
      ratio,
      openFeeRate: 0,
      closeFeeRate: 0,
      slippageRate: 0,
    });

    return costs.totalCostUsd;
  }

  private calculateAverageMaxDepositedUsd(positions: PerpTradePosition[]) {
    if (positions.length === 0) {
      return 0;
    }

    return (
      sum(
        positions.map((position) =>
          this.calculatePositionMaxDepositedUsd(position),
        ),
      ) / positions.length
    );
  }

  private simulateCopyApproximation(
    positions: PerpTradePosition[],
    ratio: number,
    direction: Simulation['direction'],
  ): ReverseSimulationResult {
    const directionMultiplier = direction === 'Reversed' ? -1 : 1;
    const grossPositionPnls = positions.map((position) => {
      const reverseBasePnl =
        sum(position.histories.map((history) => history.usdBasePnl)) *
        ratio *
        directionMultiplier;
      const maxLoss =
        -Math.abs(this.calculatePositionMaxDepositedUsd(position)) * ratio;

      return Math.max(maxLoss, reverseBasePnl);
    });
    const costs = calculateCosts({
      positions,
      ratio,
      openFeeRate: 0,
      closeFeeRate: 0,
      slippageRate: 0,
    });
    const netPositionPnls = grossPositionPnls.map(
      (positionPnl, index) =>
        positionPnl - this.calculatePositionCost(positions[index], ratio),
    );
    const equityCurve = cumulative(netPositionPnls);
    const trend = calculateTrend(equityCurve);
    const grossProfitUsd = sum(grossPositionPnls.filter((item) => item > 0));

    return {
      grossPnlUsd: sum(grossPositionPnls),
      netPnlUsd: sum(netPositionPnls),
      totalCostUsd: costs.totalCostUsd,
      maxDrawdownUsd: calculateMaxDrawdown(equityCurve),
      slope: trend.slope,
      r2: trend.r2,
      profitFactor: calculateProfitFactor(netPositionPnls),
      grossProfitUsd,
      topTradeProfitUsd: Math.max(0, ...grossPositionPnls),
    };
  }
}
