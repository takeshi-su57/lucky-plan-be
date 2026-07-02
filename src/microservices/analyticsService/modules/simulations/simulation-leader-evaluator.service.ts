import { Injectable } from '@nestjs/common';
import dayjs from 'dayjs';

import { Simulation } from 'src/microservices/apiService/modules/simulations/entities/simulations.entity';

import { PrismaService } from 'src/global/prisma.service';
import { EventLogsService } from 'src/microservices/apiService/modules/trade-histories/event-logs.service';
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
import { SimulationLeaderEventLogCacheService } from './simulation-leader-event-log-cache.service';

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

export type CandidateEvaluation = {
  leaderAddress: string;
  lastEventAt?: Date | null;
  score: number;
  suggestedRatio: number;
  suggestedCollateralUsd: number;
  rawTotalPnlUsd: number;
  rawSlope: number;
  rawR2: number;
  rawTradeCount: number;
  copiedNetPnlUsd: number;
  copiedDrawdownUsd: number;
  rejectedReason?: string;
};

export type ContractContext = {
  id: number;
  chainId: number;
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

const CANDIDATE_BATCH_SIZE = 100;
const CANDIDATE_RECENT_ACTIVITY_DAYS = 30;
const LEADER_SCORING_WINDOW_DAYS = 180;
const PLATFORM_MIN_FEE_USD = 0.5;

@Injectable()
export class SimulationLeaderEvaluatorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventLogsService: EventLogsService,
    private readonly leaderEventLogCacheService: SimulationLeaderEventLogCacheService,
  ) {}

  async findCandidateLeaders(simulation: Simulation, range: WindowRange) {
    const dateStr = dayjs(range.startedAt).format('YYYY-MM-DD');
    const candidateAddresses: string[] = [];

    for (let skip = 0; ; skip += CANDIDATE_BATCH_SIZE) {
      const records = await this.prisma.pnlSnapshotV2.findMany({
        where: {
          platform: simulation.platform,
          dateStr,
          accUSDPnl:
            simulation.direction === BotMode.Default
              ? {
                  gte: 50,
                }
              : {
                  lte: -50,
                },
        },
        select: {
          address: true,
        },
        orderBy: [{ accUSDPnl: 'asc' }, { address: 'asc' }],
        skip,
        take: CANDIDATE_BATCH_SIZE,
      });

      const batchAddresses = records.map((record) =>
        record.address.toLowerCase(),
      );
      const activeBatch = await this.filterRecentlyActiveCandidateAddresses(
        simulation,
        batchAddresses,
        range,
      );

      candidateAddresses.push(...activeBatch);

      if (records.length < CANDIDATE_BATCH_SIZE) {
        break;
      }
    }

    return candidateAddresses;
  }

  async filterCandidateLeaderAddresses(
    simulation: Simulation,
    leaderAddresses: string[],
    range: WindowRange,
  ) {
    const dateStr = dayjs(range.startedAt).format('YYYY-MM-DD');
    const normalizedAddresses = [
      ...new Set(leaderAddresses.map((address) => address.toLowerCase())),
    ];

    if (normalizedAddresses.length === 0) {
      return [];
    }

    const records = await this.prisma.pnlSnapshotV2.findMany({
      where: {
        platform: simulation.platform,
        dateStr,
        address: {
          in: normalizedAddresses,
        },
        accUSDPnl:
          simulation.direction === BotMode.Default
            ? {
                gte: 50,
              }
            : {
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

    return this.filterRecentlyActiveCandidateAddresses(
      simulation,
      candidateAddresses,
      range,
    );
  }

  private async filterRecentlyActiveCandidateAddresses(
    simulation: Simulation,
    candidateAddresses: string[],
    range: WindowRange,
  ) {
    const recentActivityCutoff = dayjs(range.startedAt)
      .subtract(CANDIDATE_RECENT_ACTIVITY_DAYS, 'day')
      .toDate();
    const prefilteredAddresses: string[] = [];

    for (
      let offset = 0;
      offset < candidateAddresses.length;
      offset += CANDIDATE_BATCH_SIZE
    ) {
      const addressBatch = candidateAddresses.slice(
        offset,
        offset + CANDIDATE_BATCH_SIZE,
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
          return;
        }

        if (recentTradeHistoryCount < simulation.trade.min) {
          return;
        }

        prefilteredAddresses.push(address);
      });
    }

    return prefilteredAddresses;
  }

  async findChangedLeaderAddresses(simulation: Simulation, range: WindowRange) {
    const records = await this.prisma.perpTradingEventLog.groupBy({
      by: ['address'],
      where: {
        platform: simulation.platform,
        date: {
          gte: range.startedAt,
          lt: range.endedAt,
        },
      },
    });

    return records
      .map((record) => record.address.toLowerCase())
      .sort((a, b) => a.localeCompare(b));
  }

  async getLastEventAtByLeader(
    simulation: Simulation,
    leaderAddresses: string[],
    before: Date,
  ) {
    const normalizedAddresses = [
      ...new Set(leaderAddresses.map((address) => address.toLowerCase())),
    ];

    if (normalizedAddresses.length === 0) {
      return new Map<string, Date>();
    }

    const groups = await this.prisma.perpTradingEventLog.groupBy({
      by: ['address'],
      where: {
        platform: simulation.platform,
        address: {
          in: normalizedAddresses,
        },
        date: {
          lt: before,
        },
      },
      _max: {
        date: true,
      },
    });

    const lastEventAtByLeader = new Map(
      groups.flatMap((group) =>
        group._max.date
          ? [[group.address.toLowerCase(), group._max.date] as const]
          : [],
      ),
    );

    return lastEventAtByLeader;
  }

  async evaluateLeadersForRange(
    simulation: Simulation,
    leaderAddresses: string[],
    range: WindowRange,
    contractById: Map<number, ContractContext>,
  ) {
    const dateStr = dayjs(range.startedAt).format('YYYY-MM-DD');
    const baseLabel = `[simulation:evaluator:${simulation.id}:${dateStr}] evaluateLeadersForRange`;
    console.time(`${baseLabel} total leaders=${leaderAddresses.length}`);
    const evaluations: CandidateEvaluation[] = [];
    console.time(`${baseLabel} getLastEventAtByLeader`);
    const lastEventAtByLeader = await this.getLastEventAtByLeader(
      simulation,
      leaderAddresses,
      range.startedAt,
    );
    console.timeEnd(`${baseLabel} getLastEventAtByLeader`);

    console.log(`${baseLabel} leaderAddresses ${leaderAddresses.length}`);

    console.time(`${baseLabel} leaderLoop`);
    for (const leaderAddress of leaderAddresses) {
      const positions = await this.loadLeaderPositionsByLeaderUntil(
        leaderAddress,
        simulation,
        contractById,
        range.startedAt,
      );
      console.time(`${baseLabel} evaluateLeader`);

      const closedPositions = this.getClosedPositionsBefore(
        positions,
        range.startedAt,
      );

      const evaluation = this.evaluateLeaderPositionsForSimulation(
        leaderAddress,
        closedPositions,
        simulation,
      );

      const rejectedReason =
        evaluation.rejectedReason ||
        (!valueMatchesRange(evaluation.score, simulation.score)
          ? 'SCORE_OUT_OF_RANGE'
          : null);

      if (rejectedReason) {
        console.timeEnd(`${baseLabel} evaluateLeader`);
        continue;
      }

      evaluations.push({
        ...evaluation,
        lastEventAt: lastEventAtByLeader.get(leaderAddress.toLowerCase()),
      });
      console.timeEnd(`${baseLabel} evaluateLeader`);
    }
    console.timeEnd(`${baseLabel} leaderLoop`);

    console.timeEnd(`${baseLabel} total leaders=${leaderAddresses.length}`);

    return evaluations;
  }

  private async loadLeaderPositionsByLeaderUntil(
    leaderAddress: string,
    simulation: Simulation,
    contractById: Map<number, ContractContext>,
    before: Date,
  ) {
    const normalizedLeaderAddress = leaderAddress.toLowerCase();
    const scoringStartedAt = dayjs(before)
      .subtract(LEADER_SCORING_WINDOW_DAYS, 'day')
      .toDate();
    const dateStr = dayjs(before).format('YYYY-MM-DD');
    const baseLabel = `[simulation:evaluator:${simulation.id}:${dateStr}] loadLeaderPositionsByLeaderUntil`;
    const refreshStartedAt =
      this.leaderEventLogCacheService.getRefreshStartedAt(
        simulation.platform,
        normalizedLeaderAddress,
        scoringStartedAt,
      );

    console.time(`${baseLabel} total address=${normalizedLeaderAddress}`);
    console.time(`${baseLabel} dbQuery`);
    const records = await this.prisma.perpTradingEventLog.findMany({
      select: {
        id: true,
        address: true,
        date: true,
        block: true,
        contractId: true,
        platform: true,
        jsonLog: true,
      },
      where: {
        address: normalizedLeaderAddress,
        platform: simulation.platform,
        date: {
          gte: refreshStartedAt,
          lt: before,
        },
      },
      orderBy: [
        { address: 'asc' },
        { date: 'asc' },
        { block: 'asc' },
        { id: 'asc' },
      ],
    });
    console.timeEnd(`${baseLabel} dbQuery`);

    const { records: cachedRecords } =
      await this.leaderEventLogCacheService.updateCache(
        simulation.platform,
        normalizedLeaderAddress,
        records,
        scoringStartedAt,
        before,
      );

    console.time(`${baseLabel} convertToPerpTradePositionsWithSummary`);

    const histories = this.eventLogsToHistories(cachedRecords, contractById);

    const positionsWithSummary =
      this.eventLogsService.convertToPerpTradePositionsWithSummary(
        simulation.platform,
        histories,
        {
          minCollateral: simulation.collateral.min,
          maxCollateral: simulation.collateral.max,
          minLeverage: simulation.leverage.min,
          maxLeverage: simulation.leverage.max,
        },
      );

    const positions = positionsWithSummary.positions;

    console.timeEnd(`${baseLabel} convertToPerpTradePositionsWithSummary`);

    console.timeEnd(`${baseLabel} total address=${normalizedLeaderAddress}`);

    return positions;
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
      copiedNetPnlUsd: 0,
      copiedDrawdownUsd: 0,
    };
    const effectiveSlopeRange = getDirectionalSlopeRange(
      simulation.direction,
      simulation.slope,
    );

    if (!valueMatchesRange(rawTradeCount, simulation.trade)) {
      return { ...baseEvaluation, rejectedReason: 'TRADE_COUNT_OUT_OF_RANGE' };
    }

    const rawAvgDurationMs =
      this.calculateAveragePositionDurationMs(closedPositions);

    if (
      rawAvgDurationMs !== null &&
      rawAvgDurationMs < BOT_TRADER_MIN_AVG_DURATION_MS
    ) {
      return {
        ...baseEvaluation,
        rejectedReason: 'BOT_TRADER_AVG_DURATION_TOO_SHORT',
      };
    }

    if (!valueMatchesRange(rawTrend.slope, effectiveSlopeRange)) {
      return { ...baseEvaluation, rejectedReason: 'SLOPE_OUT_OF_RANGE' };
    }

    if (!valueMatchesRange(rawTrend.r2, simulation.r2)) {
      return { ...baseEvaluation, rejectedReason: 'R2_OUT_OF_RANGE' };
    }

    if (rawAvgCollateralUsd < SIMULATION_SYSTEM_CONFIG.minCollateralUsd) {
      return { ...baseEvaluation, rejectedReason: 'LOW_AVG_COLLATERAL' };
    }

    const preliminaryCopy = this.simulateCopyApproximation(
      closedPositions,
      1,
      simulation.direction,
    );
    const preliminaryScore = this.scoreCandidate(
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
    const copied = this.simulateCopyApproximation(
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
      minTrades: simulation.trade.min,
      maxCopiedDrawdownUsd: SIMULATION_SYSTEM_CONFIG.maxCollateralUsd,
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

  private calculateAveragePositionDurationMs(
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

  private simulateCopyApproximation(
    positions: PerpTradePosition[],
    ratio: number,
    direction: Simulation['direction'],
  ): CopySimulationResult {
    const directionMultiplier = direction === 'Reversed' ? -1 : 1;
    let totalCostUsd = 0;
    const grossPositionPnls = positions.map((position) => {
      const copiedPnl = sum(
        position.histories.map((history) => {
          const copiedFee = this.calculateCopiedPlatformFee(
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
        -Math.abs(this.calculatePositionMaxDepositedUsd(position)) * ratio;

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

  private calculateCopiedPlatformFee(usdFee: number, ratio: number) {
    if (usdFee === 0) {
      return 0;
    }

    return Math.min(-PLATFORM_MIN_FEE_USD, usdFee * ratio);
  }
}
