import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import dayjs from 'dayjs';

import { Simulation } from 'src/microservices/apiService/modules/simulations/entities/simulations.entity';

import { PrismaService } from 'src/global/prisma.service';
import { Platform, SimulationStatus } from 'generated/prisma/enums';
import {
  calculateMaxDrawdown,
  calculateProfitFactor,
  cumulative,
  sum,
} from './utils/simulation-automation.utils';
import { getReadableError } from 'src/utils';
import {
  buildSimulationRanges,
  WindowRange,
} from './utils/simulation-range.utils';
import {
  CandidateEvaluation,
  SimulationLeaderEvaluatorService,
} from './simulation-leader-evaluator.service';
import { SimulationCacheService } from './simulation-cache.service';
import { PATTERNS, SERVICE_NAMES } from 'src/utils/constants';
import {
  SimulationPlan,
  SimulationResearch,
} from 'src/microservices/apiService/modules/simulations/entities/simulations.entity';

type ValueRange = {
  min: number;
  max: number;
};

const DEFAULT_TRADE_RANGE: ValueRange = { min: 3, max: 1000000 };
const DEFAULT_R2_RANGE: ValueRange = { min: 0.5, max: 1 };
const DEFAULT_SLOPE_RANGE: ValueRange = { min: 0, max: 1000000000 };
const DEFAULT_LEVERAGE_RANGE: ValueRange = { min: 0, max: 50 };
const DEFAULT_SCORE_RANGE: ValueRange = { min: 0, max: 1 };

type AutoSimulationRunMode = 'manual' | 'queue';

type AutoSimulationRunOptions = {
  mode: AutoSimulationRunMode;
  horizon?: Date;
  runInBackground: boolean;
};

@Injectable()
export class SimulationAutoRunnerService {
  private readonly activeAutoSimulationRunIds = new Set<number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly simulationCacheService: SimulationCacheService,
    private readonly simulationLeaderEvaluatorService: SimulationLeaderEvaluatorService,
    @Inject(SERVICE_NAMES.REDIS_SERVICE)
    private readonly redisClient: ClientProxy,
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
      leverage:
        (record.leverage as ValueRange | null) ?? DEFAULT_LEVERAGE_RANGE,
      score: (record.score as ValueRange | null) ?? DEFAULT_SCORE_RANGE,
    };
  }

  private mapSimulationResearch(record: any): SimulationResearch {
    const simulations = record.simulations || [];
    const totalSimulations = simulations.length;
    const completedSimulations = simulations.filter(
      (simulation: { status: SimulationStatus }) =>
        simulation.status === SimulationStatus.Completed,
    ).length;

    return {
      id: record.id,
      title: record.title,
      description: record.description,
      platform: record.platform,
      startAt: record.startAt,
      endAt: record.endAt,
      days: record.days ?? 1,
      gapDays: record.gapDays ?? 0,
      direction: record.direction,
      trade: record.trade as any,
      r2: record.r2 as any,
      slope: record.slope as any,
      leverage: (record.leverage as ValueRange[] | null) ?? [],
      score: (record.score as ValueRange[] | null) ?? [],
      totalSimulations,
      completedSimulations,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  async emitSimulationUpdated(record: any) {
    const simulation = this.mapSimulation(record);

    await this.redisClient.emit(
      PATTERNS.Simulations.SimulationUpdated,
      simulation,
    );

    if (!simulation.researchId) {
      return;
    }

    const research = await this.prisma.simulationResearch.findUnique({
      where: { id: simulation.researchId },
      include: {
        simulations: {
          select: {
            status: true,
          },
        },
      },
    });

    if (!research) {
      return;
    }

    await this.redisClient.emit(
      PATTERNS.Simulations.SimulationResearchUpdated,
      this.mapSimulationResearch(research),
    );
  }

  private async getSimulationPlanForUpdate(
    id: number,
  ): Promise<SimulationPlan | null> {
    return await this.prisma.simulationPlan.findUnique({
      where: { id },
      include: {
        simulationBots: true,
      },
    });
  }

  private async emitSimulationPlanUpdated(id: number) {
    const simulationPlan = await this.getSimulationPlanForUpdate(id);

    if (!simulationPlan) {
      return;
    }

    await this.redisClient.emit(
      PATTERNS.Simulations.SimulationPlanUpdated,
      simulationPlan,
    );
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

    const totalSimulationPlans = buildSimulationRanges(
      simulation.startAt,
      simulation.endAt,
      { days: simulation.days, gapDays: simulation.gapDays },
    ).length;

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
    await this.emitSimulationUpdated(updatedSimulation);

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
        return;
      }

      const allRanges = buildSimulationRanges(
        simulation.startAt,
        simulation.endAt,
        { days: simulation.days, gapDays: simulation.gapDays },
      );
      const horizon = options.horizon ?? simulation.endAt;
      const startedAt = simulation.cursor ?? simulation.startAt;
      const ranges = allRanges.filter(
        (range) =>
          range.endedAt.getTime() > startedAt.getTime() &&
          range.endedAt.getTime() <= horizon.getTime(),
      );
      if (ranges.length === 0) {
        const pausedSimulation = await this.prisma.simulation.update({
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
        await this.emitSimulationUpdated(pausedSimulation);
        return;
      }

      const platformContracts = await this.prisma.contract.findMany({
        where: { platform: simulation.platform },
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
      for (const range of ranges) {
        const currentRecord = await this.prisma.simulation.findUnique({
          where: { id },
        });
        const current = currentRecord
          ? this.mapSimulation(currentRecord)
          : null;

        if (!current || current.status === SimulationStatus.Cancelled) {
          return;
        }

        const selectingSimulation = await this.prisma.simulation.update({
          where: { id },
          data: {
            progressPhase: 'leader-selection',
            progressMessage: `Selecting leaders for ${dayjs(
              range.startedAt,
            ).format('YYYY-MM-DD')}`,
          },
        });
        await this.emitSimulationUpdated(selectingSimulation);

        const simulationPlan = await this.createSimulationPlanForRange(
          current,
          range,
        );

        const candidateLeaders =
          await this.simulationLeaderEvaluatorService.findCandidateLeaders(
            current,
            range,
          );

        const selectedCandidates = (
          await this.simulationLeaderEvaluatorService.evaluateLeadersForRange(
            current,
            candidateLeaders,
            range,
            contractById,
          )
        ).sort((a, b) => b.score - a.score);

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

        const completedPlanWindowSimulation =
          await this.prisma.simulation.update({
            where: { id },
            data: {
              cursor: range.endedAt,
              completedPlans,
              progressPhase: 'plan-window-completed',
              progressMessage: `Completed ${dayjs(range.startedAt).format(
                'YYYY-MM-DD',
              )}`,
              progressPercent:
                allRanges.length > 0
                  ? (completedPlans / allRanges.length) * 100
                  : 100,
            },
          });
        await this.emitSimulationUpdated(completedPlanWindowSimulation);
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
      const failedSimulation = await this.prisma.simulation.update({
        where: { id },
        data: {
          status: SimulationStatus.Failed,
          progressPhase: 'failed',
          progressMessage: 'Auto simulation failed',
          error: getReadableError(error),
        },
      });
      await this.emitSimulationUpdated(failedSimulation);
    } finally {
      this.activeAutoSimulationRunIds.delete(id);
    }
  }

  private async createSimulationPlanForRange(
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

      await this.emitSimulationPlanUpdated(existingSimulationPlan.id);

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
    await this.emitSimulationPlanUpdated(simulationPlan.id);

    return simulationPlan;
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
      by: ['address'],
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
    const tradedLeaderAddresses = new Set<string>();

    tradedContractGroups.forEach((group) => {
      tradedLeaderAddresses.add(group.address.toLowerCase());
    });

    const botInputs = selectedCandidates
      .filter((candidate) =>
        tradedLeaderAddresses.has(candidate.leaderAddress.toLowerCase()),
      )
      .map((candidate) => ({
        leaderAddress: candidate.leaderAddress,
        leaderPlatform: simulation.platform,
        simulationPlanId,
        startedAt,
        stoppedAt,
        mode: simulation.direction,
        ratio: candidate.suggestedRatio,
        score: candidate.score,
        minLeverage: simulation.leverage.min,
        maxLeverage: simulation.leverage.max,
      }));

    if (botInputs.length === 0) {
      return;
    }

    await this.prisma.simulationBot.createMany({
      data: botInputs,
      skipDuplicates: true,
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

    const updatedSimulation = await this.prisma.simulation.update({
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
    await this.emitSimulationUpdated(updatedSimulation);
  }
}
