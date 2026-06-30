import { Injectable, Logger } from '@nestjs/common';
import dayjs from 'dayjs';

import { Simulation } from 'src/microservices/apiService/modules/simulations/entities/simulations.entity';

import { PrismaService } from 'src/global/prisma.service';
import {
  ContractStatus,
  Platform,
  SimulationStatus,
} from 'generated/prisma/enums';
import {
  calculateMaxDrawdown,
  calculateProfitFactor,
  cumulative,
  sum,
} from './simulation-automation.utils';
import { getReadableError } from 'src/utils';
import {
  buildDailyRanges,
  getRangeKey,
  WindowRange,
} from './simulation-range.utils';
import {
  CandidateEvaluation,
  LeaderPositionsCache,
  RangeEvaluationMap,
  SimulationLeaderEvaluatorService,
} from './simulation-leader-evaluator.service';
import { SimulationCacheService } from './simulation-cache.service';

type ValueRange = {
  min: number;
  max: number;
};

const DEFAULT_TRADE_RANGE: ValueRange = { min: 3, max: 1000000 };
const DEFAULT_R2_RANGE: ValueRange = { min: 0.5, max: 1 };
const DEFAULT_SLOPE_RANGE: ValueRange = { min: 0, max: 1000000000 };

type AutoSimulationRunMode = 'manual' | 'queue';

type AutoSimulationRunOptions = {
  mode: AutoSimulationRunMode;
  horizon?: Date;
  runInBackground: boolean;
};

@Injectable()
export class SimulationAutoRunnerService {
  private readonly logger = new Logger(SimulationAutoRunnerService.name);
  private readonly activeAutoSimulationRunIds = new Set<number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly simulationCacheService: SimulationCacheService,
    private readonly simulationLeaderEvaluatorService: SimulationLeaderEvaluatorService,
  ) {}

  clearActiveRun(id: number) {
    this.activeAutoSimulationRunIds.delete(id);
  }

  isAutoSimulationActive(id: number) {
    return this.activeAutoSimulationRunIds.has(id);
  }

  static getTerminalStatusForHorizon(input: { cursor: Date; endAt: Date }) {
    return input.cursor.getTime() >= input.endAt.getTime()
      ? SimulationStatus.Completed
      : SimulationStatus.Paused;
  }

  private mapSimulation(record: any): Simulation {
    return {
      ...record,
      trade: (record.trade as ValueRange | null) ?? DEFAULT_TRADE_RANGE,
      r2: (record.r2 as ValueRange | null) ?? DEFAULT_R2_RANGE,
      slope: (record.slope as ValueRange | null) ?? DEFAULT_SLOPE_RANGE,
    };
  }

  async playAutoSimulation(id: number): Promise<Simulation> {
    return this.startAutoSimulation(id, {
      mode: 'manual',
      runInBackground: true,
    });
  }

  async playQueuedAutoSimulation(
    id: number,
    horizon: Date,
  ): Promise<Simulation> {
    return this.startAutoSimulation(id, {
      mode: 'queue',
      horizon,
      runInBackground: false,
    });
  }

  private async startAutoSimulation(
    id: number,
    options: AutoSimulationRunOptions,
  ): Promise<Simulation> {
    const simulationRecord = await this.prisma.simulation.findUnique({
      where: { id },
    });
    const simulation = simulationRecord
      ? this.mapSimulation(simulationRecord)
      : null;

    if (!simulation) {
      throw new Error('Simulation not found');
    }

    if (
      simulation.status === SimulationStatus.Running &&
      this.activeAutoSimulationRunIds.has(id)
    ) {
      throw new Error('Simulation is already running');
    }

    if (simulation.status === SimulationStatus.Running) {
      this.logWarn('Recovering running auto simulation without active worker', {
        simulationId: id,
        cursor: simulation.cursor,
        completedPlans: simulation.completedPlans,
      });
    }

    const totalSimulationPlans = buildDailyRanges(
      simulation.startAt,
      simulation.endAt,
    ).length;

    this.logDebug('Auto simulation run accepted', {
      simulationId: id,
      status: simulation.status,
      cursor: simulation.cursor,
      completedPlans: simulation.completedPlans,
      totalSimulationPlans,
    });

    const updatedSimulation = await this.prisma.simulation.update({
      where: { id },
      data: {
        status: SimulationStatus.Running,
        error: null,
        totalSimulationPlans,
        progressPhase: 'accepted',
        progressMessage: 'Auto simulation accepted',
        progressPercent:
          totalSimulationPlans > 0
            ? (simulation.completedPlans / totalSimulationPlans) * 100
            : 100,
      },
    });

    this.activeAutoSimulationRunIds.add(id);

    if (options.runInBackground) {
      setTimeout(() => {
        void this.runAutoSimulation(id, options);
      }, 0);
    } else {
      await this.runAutoSimulation(id, options);
    }

    return this.mapSimulation(updatedSimulation);
  }

  private logDebug(message: string, metadata?: Record<string, unknown>) {
    this.logger.debug(
      metadata ? `${message} ${JSON.stringify(metadata)}` : message,
    );
  }

  private logWarn(message: string, metadata?: Record<string, unknown>) {
    this.logger.warn(
      metadata ? `${message} ${JSON.stringify(metadata)}` : message,
    );
  }

  private logError(
    message: string,
    error: unknown,
    metadata?: Record<string, unknown>,
  ) {
    this.logger.error(
      metadata ? `${message} ${JSON.stringify(metadata)}` : message,
      error instanceof Error ? error.stack : undefined,
    );
  }

  private async runAutoSimulation(
    id: number,
    options: AutoSimulationRunOptions,
  ) {
    if (!this.activeAutoSimulationRunIds.has(id)) {
      this.activeAutoSimulationRunIds.add(id);
    }

    try {
      const simulationRecord = await this.prisma.simulation.findUnique({
        where: { id },
      });
      const simulation = simulationRecord
        ? this.mapSimulation(simulationRecord)
        : null;

      if (!simulation) {
        this.logWarn('Auto simulation run aborted: simulation not found', {
          simulationId: id,
        });
        return;
      }

      const allRanges = buildDailyRanges(simulation.startAt, simulation.endAt);
      const horizon = options.horizon ?? simulation.endAt;
      const startedAt = simulation.cursor ?? simulation.startAt;
      const ranges = allRanges.filter(
        (range) =>
          range.endedAt.getTime() > startedAt.getTime() &&
          range.endedAt.getTime() <= horizon.getTime(),
      );
      const warmupRanges = simulation.cursor
        ? allRanges.filter(
            (range) => range.endedAt.getTime() <= startedAt.getTime(),
          )
        : [];

      this.logDebug('Auto simulation run started', {
        simulationId: id,
        platform: simulation.platform,
        startAt: simulation.startAt,
        endAt: simulation.endAt,
        cursor: simulation.cursor,
        remainingRangeCount: ranges.length,
      });

      if (ranges.length === 0) {
        await this.prisma.simulation.update({
          where: { id },
          data: {
            status:
              (simulation.cursor ?? simulation.startAt).getTime() >=
              simulation.endAt.getTime()
                ? SimulationStatus.Completed
                : SimulationStatus.Paused,
            progressPhase: 'paused',
            progressMessage: 'Paused until more historical data is available',
          },
        });
        return;
      }

      const platformContracts = await this.prisma.contract.findMany({
        where: { platform: simulation.platform, status: ContractStatus.Live },
        orderBy: [{ chainId: 'asc' }, { id: 'asc' }],
      });

      if (platformContracts.length === 0) {
        throw new Error(
          `No contracts found for platform ${simulation.platform}`,
        );
      }

      const contractById = new Map(
        platformContracts.map((contract) => [contract.id, contract]),
      );
      const planByRangeKey = await this.createDailySimulationPlans(
        simulation,
        allRanges,
      );
      const checkedLeaderAddresses = new Set<string>();
      const selectedCandidatesByRangeKey: RangeEvaluationMap = new Map();
      const leaderPositionsCache: LeaderPositionsCache = new Map();

      this.logDebug('Auto simulation plans ready', {
        simulationId: id,
        totalPlanCount: allRanges.length,
        remainingRangeCount: ranges.length,
      });

      if (warmupRanges.length > 0 && ranges.length > 0) {
        let evaluatedCount = 0;
        let acceptedCount = 0;

        for (const warmupRange of warmupRanges) {
          const candidateLeaders =
            await this.simulationLeaderEvaluatorService.findCandidateLeaders(
              simulation,
              warmupRange,
              checkedLeaderAddresses,
              false,
            );
          candidateLeaders.forEach((leaderAddress) =>
            checkedLeaderAddresses.add(leaderAddress),
          );

          const stats =
            await this.simulationLeaderEvaluatorService.evaluateLeadersAcrossRanges(
              simulation,
              candidateLeaders,
              ranges,
              contractById,
              leaderPositionsCache,
              selectedCandidatesByRangeKey,
            );

          evaluatedCount += stats.evaluatedCount;
          acceptedCount += stats.acceptedCount;
        }

        this.logDebug('Auto simulation recovery candidates warmed', {
          simulationId: id,
          warmupRangeCount: warmupRanges.length,
          remainingRangeCount: ranges.length,
          evaluatedCount,
          acceptedCount,
        });
      }

      for (const range of ranges) {
        const currentRecord = await this.prisma.simulation.findUnique({
          where: { id },
        });
        const current = currentRecord
          ? this.mapSimulation(currentRecord)
          : null;

        if (!current || current.status === SimulationStatus.Cancelled) {
          this.logWarn('Auto simulation run stopped before daily range', {
            simulationId: id,
            rangeStartAt: range.startedAt,
            currentStatus: current?.status,
          });
          return;
        }

        this.logDebug('Auto simulation day started', {
          simulationId: id,
          day: dayjs(range.startedAt).format('YYYY-MM-DD'),
          rangeStartAt: range.startedAt,
          rangeEndAt: range.endedAt,
        });

        await this.prisma.simulation.update({
          where: { id },
          data: {
            progressPhase: 'leader-selection',
            progressMessage: `Selecting leaders for ${dayjs(
              range.startedAt,
            ).format('YYYY-MM-DD')}`,
          },
        });

        const rangeKey = getRangeKey(range);
        const simulationPlan = planByRangeKey.get(rangeKey);

        if (!simulationPlan) {
          throw new Error(`Simulation plan not found for ${rangeKey}`);
        }

        const candidateLeaders =
          await this.simulationLeaderEvaluatorService.findCandidateLeaders(
            current,
            range,
            checkedLeaderAddresses,
          );
        candidateLeaders.forEach((leaderAddress) =>
          checkedLeaderAddresses.add(leaderAddress),
        );

        const evaluationStats =
          await this.simulationLeaderEvaluatorService.evaluateLeadersAcrossRanges(
            current,
            candidateLeaders,
            ranges.filter(
              (item) => item.startedAt.getTime() >= range.startedAt.getTime(),
            ),
            contractById,
            leaderPositionsCache,
            selectedCandidatesByRangeKey,
          );

        this.logDebug('Auto simulation candidates evaluated', {
          simulationId: id,
          day: rangeKey,
          newLeaderCount: candidateLeaders.length,
          evaluatedCount: evaluationStats.evaluatedCount,
          acceptedCount: evaluationStats.acceptedCount,
        });

        const selectedCandidates = (
          selectedCandidatesByRangeKey.get(rangeKey) || []
        ).sort((a, b) => b.score - a.score);

        this.logDebug('Auto simulation day selected leaders', {
          simulationId: id,
          simulationPlanId: simulationPlan.id,
          day: rangeKey,
          selectedCount: selectedCandidates.length,
        });

        await this.persistLeaderSelections(
          current.id,
          simulationPlan.id,
          range.startedAt,
          selectedCandidates,
        );
        await this.createSimulationBotsForSelections(
          simulationPlan.id,
          range.startedAt,
          range.endedAt,
          current,
          selectedCandidates,
          platformContracts,
        );

        const completedPlans = allRanges.filter(
          (item) => item.endedAt.getTime() <= range.endedAt.getTime(),
        ).length;

        await this.prisma.simulation.update({
          where: { id },
          data: {
            cursor: range.endedAt,
            completedPlans,
            progressPhase: 'daily-plan-completed',
            progressMessage: `Completed ${dayjs(range.startedAt).format(
              'YYYY-MM-DD',
            )}`,
            progressPercent:
              allRanges.length > 0
                ? (completedPlans / allRanges.length) * 100
                : 100,
          },
        });

        this.logDebug('Auto simulation day completed', {
          simulationId: id,
          simulationPlanId: simulationPlan.id,
          day: dayjs(range.startedAt).format('YYYY-MM-DD'),
          completedPlans,
          totalPlans: allRanges.length,
        });
      }

      const latestRecord = await this.prisma.simulation.findUnique({
        where: { id },
      });
      const latest = latestRecord ? this.mapSimulation(latestRecord) : null;

      if (!latest?.cursor) {
        return;
      }

      await this.aggregateSimulation(id, {
        status: SimulationAutoRunnerService.getTerminalStatusForHorizon({
          cursor: latest.cursor,
          endAt: latest.endAt,
        }),
        through: latest.cursor,
      });
    } catch (error) {
      this.logError('Auto simulation failed', error, {
        simulationId: id,
        error: getReadableError(error),
      });

      await this.prisma.simulation.update({
        where: { id },
        data: {
          status: SimulationStatus.Failed,
          progressPhase: 'failed',
          progressMessage: 'Auto simulation failed',
          error: getReadableError(error),
        },
      });
    } finally {
      this.activeAutoSimulationRunIds.delete(id);
    }
  }

  private async createDailySimulationPlan(
    simulation: Simulation,
    range: WindowRange,
  ) {
    const existingSimulationPlan = await this.prisma.simulationPlan.findFirst({
      where: {
        simulationId: simulation.id,
        startAt: range.startedAt,
        endAt: range.endedAt,
      },
    });

    if (existingSimulationPlan) {
      await this.simulationCacheService.ensureSimulationPlanCache(
        existingSimulationPlan.id,
      );

      this.logDebug('Auto simulation day reusing existing plan', {
        simulationId: simulation.id,
        simulationPlanId: existingSimulationPlan.id,
        day: dayjs(range.startedAt).format('YYYY-MM-DD'),
      });

      return existingSimulationPlan;
    }

    const simulationPlan = await this.prisma.simulationPlan.create({
      data: {
        title: `${simulation.title} ${dayjs(range.startedAt).format(
          'YYYY-MM-DD',
        )}`,
        description: simulation.description,
        startAt: range.startedAt,
        endAt: range.endedAt,
        cursor: range.endedAt,
        simulationId: simulation.id,
      },
    });

    await this.simulationCacheService.ensureSimulationPlanCache(
      simulationPlan.id,
    );

    return simulationPlan;
  }

  private async createDailySimulationPlans(
    simulation: Simulation,
    ranges: WindowRange[],
  ) {
    const planByRangeKey = new Map<string, { id: number }>();

    for (const range of ranges) {
      planByRangeKey.set(
        getRangeKey(range),
        await this.createDailySimulationPlan(simulation, range),
      );
    }

    return planByRangeKey;
  }

  private async persistLeaderSelections(
    simulationId: number,
    simulationPlanId: number,
    date: Date,
    selectedCandidates: CandidateEvaluation[],
  ) {
    if (selectedCandidates.length === 0) {
      return;
    }

    await this.prisma.simulationLeaderSelection.createMany({
      data: selectedCandidates.map((candidate) => ({
        simulationId,
        simulationPlanId,
        leaderAddress: candidate.leaderAddress,
        date,
        score: candidate.score,
        suggestedRatio: candidate.suggestedRatio,
        suggestedCollateralUsd: candidate.suggestedCollateralUsd,
        rawTotalPnlUsd: candidate.rawTotalPnlUsd,
        rawSlope: candidate.rawSlope,
        rawR2: candidate.rawR2,
        rawTradeCount: candidate.rawTradeCount,
        reverseNetPnlUsd: candidate.reverseNetPnlUsd,
        reverseDrawdownUsd: candidate.reverseDrawdownUsd,
      })),
      skipDuplicates: true,
    });
  }

  private async createSimulationBotsForSelections(
    simulationPlanId: number,
    startedAt: Date,
    stoppedAt: Date,
    simulation: Simulation,
    selectedCandidates: CandidateEvaluation[],
    contracts: { id: number; platform: Platform }[],
  ) {
    if (selectedCandidates.length === 0 || contracts.length === 0) {
      return;
    }

    const existingBotCount = await this.prisma.simulationBot.count({
      where: { simulationPlanId },
    });

    if (existingBotCount > 0) {
      this.logDebug('Auto simulation day reused existing bots', {
        simulationId: simulation.id,
        simulationPlanId,
        existingBotCount,
      });
      return;
    }

    const platformContractIds = contracts
      .filter((contract) => contract.platform === simulation.platform)
      .map((contract) => contract.id);

    if (platformContractIds.length === 0) {
      return;
    }

    const leaderAddresses = selectedCandidates.map((candidate) =>
      candidate.leaderAddress.toLowerCase(),
    );
    const tradedContractGroups = await this.prisma.perpTradingEventLog.groupBy({
      by: ['address', 'contractId'],
      where: {
        platform: simulation.platform,
        address: {
          in: leaderAddresses,
        },
        contractId: {
          in: platformContractIds,
        },
        date: {
          gte: startedAt,
          lt: stoppedAt,
        },
      },
    });
    const contractIdsByLeaderAddress = new Map<string, Set<number>>();

    tradedContractGroups.forEach((group) => {
      const leaderAddress = group.address.toLowerCase();
      const contractIds =
        contractIdsByLeaderAddress.get(leaderAddress) || new Set<number>();

      contractIds.add(group.contractId);
      contractIdsByLeaderAddress.set(leaderAddress, contractIds);
    });

    const botInputs = selectedCandidates.flatMap((candidate) => {
      const contractIds =
        contractIdsByLeaderAddress.get(candidate.leaderAddress.toLowerCase()) ||
        new Set<number>();

      return [...contractIds].map((contractId) => ({
        leaderAddress: candidate.leaderAddress,
        leaderContractId: contractId,
        simulationPlanId,
        startedAt,
        stoppedAt,
        mode: simulation.direction,
        ratio: candidate.suggestedRatio,
        maxLeverage: simulation.maxLeverage,
      }));
    });

    if (botInputs.length === 0) {
      this.logDebug('Auto simulation day created no bots', {
        simulationId: simulation.id,
        simulationPlanId,
        selectedCount: selectedCandidates.length,
      });
      return;
    }

    await this.prisma.simulationBot.createMany({
      data: botInputs,
    });

    const createdBots = await this.prisma.simulationBot.findMany({
      where: { simulationPlanId },
      select: { id: true },
    });

    for (const bot of createdBots) {
      await this.simulationCacheService.ensureSimulationBotCache(bot.id);
    }

    await this.simulationCacheService.refreshIncompleteBotsForPlan(
      simulationPlanId,
    );

    this.logDebug('Auto simulation day created bots', {
      simulationId: simulation.id,
      simulationPlanId,
      selectedCount: selectedCandidates.length,
      botCount: botInputs.length,
    });
  }

  private async aggregateSimulation(
    id: number,
    options: { status: SimulationStatus; through?: Date } = {
      status: SimulationStatus.Completed,
    },
  ) {
    const plans = await this.prisma.simulationPlan.findMany({
      where: {
        simulationId: id,
        ...(options.through ? { endAt: { lte: options.through } } : {}),
      },
      orderBy: [{ startAt: 'asc' }, { id: 'asc' }],
      include: {
        cache: true,
        simulationBots: {
          include: {
            cache: true,
          },
        },
      },
    });

    const followerPositionPnls: number[] = [];
    let totalLeaderPnl = 0;

    for (const plan of plans) {
      await this.simulationCacheService.refreshIncompleteBotsForPlan(plan.id);

      const refreshedPlan = await this.prisma.simulationPlan.findUnique({
        where: { id: plan.id },
        include: {
          cache: true,
          simulationBots: {
            include: {
              cache: true,
            },
          },
        },
      });

      if (!refreshedPlan?.cache) {
        throw new Error(`Simulation plan cache not found for plan ${plan.id}`);
      }

      totalLeaderPnl += refreshedPlan.cache.totalLeaderPnl;

      refreshedPlan.simulationBots.forEach((bot) => {
        if (!bot.cache) {
          return;
        }

        const pnls = JSON.parse(bot.cache.followerPositionPnlsJson) as number[];
        followerPositionPnls.push(...pnls);
      });
    }

    const totalFollowerPnl = sum(followerPositionPnls);
    const tradeCount = followerPositionPnls.length;
    const positiveTrades = followerPositionPnls.filter(
      (item) => item > 0,
    ).length;
    const isCompleted = options.status === SimulationStatus.Completed;

    await this.prisma.simulation.update({
      where: { id },
      data: {
        status: options.status,
        progressPhase: isCompleted ? 'completed' : 'paused',
        progressMessage: isCompleted
          ? 'Auto simulation completed'
          : 'Paused until more historical data is available',
        ...(isCompleted ? { progressPercent: 100 } : {}),
        completedPlans: plans.length,
        totalLeaderPnl,
        totalFollowerPnl,
        totalNetPnlUsd: totalFollowerPnl,
        totalCostUsd: 0,
        tradeCount,
        winRate: tradeCount > 0 ? positiveTrades / tradeCount : 0,
        profitFactor: calculateProfitFactor(followerPositionPnls),
        maxDrawdownUsd: calculateMaxDrawdown(cumulative(followerPositionPnls)),
      },
    });

    this.logDebug('Auto simulation completed', {
      simulationId: id,
      completedPlans: plans.length,
      tradeCount,
      totalLeaderPnl,
      totalFollowerPnl,
    });
  }
}
