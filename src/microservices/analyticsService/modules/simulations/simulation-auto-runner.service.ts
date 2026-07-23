import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import dayjs from 'dayjs';

import { Simulation } from 'src/microservices/apiService/modules/simulations/entities/simulations.entity';

import { PrismaService } from 'src/global/prisma.service';
import { Platform, SimulationStatus } from 'generated/prisma/enums';
import { Prisma } from 'generated/prisma/client';
import {
  calculateMaxDrawdown,
  calculateProfitFactor,
  cumulative,
  sum,
} from './utils/simulation-automation.utils';
import { WindowRange } from './utils/simulation-range.utils';
import {
  CandidateEvaluation,
  SimulationLeaderEvaluatorService,
} from './simulation-leader-evaluator.service';
import { SimulationCacheService } from './simulation-cache.service';
import { PATTERNS, SERVICE_NAMES } from 'src/utils/constants';
import { SimulationResearch } from 'src/microservices/apiService/modules/simulations/entities/simulations.entity';
import {
  DEFAULT_SCORE_FORMULAR,
  DEFAULT_SIZING_FORMULAR,
  SimulationScoreFormular,
  SimulationSizingFormular,
} from 'src/microservices/apiService/modules/simulations/simulation-formulars';
import { mapSimulationBotConfiguration } from 'src/microservices/apiService/modules/simulations/simulation-bot-config.mapper';

type ValueRange = {
  min: number;
  max: number;
};

function serializeValueRanges(ranges: ValueRange[]): Prisma.InputJsonArray {
  return ranges.map(({ min, max }) => {
    const range: Prisma.InputJsonObject = { min, max };
    return range;
  });
}

const DEFAULT_TRADE_RANGE: ValueRange = { min: 3, max: 1000000 };
const DEFAULT_R2_RANGE: ValueRange = { min: 0.5, max: 1 };
const DEFAULT_SLOPE_RANGE: ValueRange = { min: 0, max: 1000000000 };
const DEFAULT_COLLATERAL_RANGE: ValueRange = { min: 0, max: 1000000000 };
const DEFAULT_SIZE_RANGE: ValueRange = { min: 0, max: 1000000000 };
const DEFAULT_LEVERAGE_RANGE: ValueRange = { min: 0, max: 50 };
const DEFAULT_SCORE_RANGE: ValueRange = { min: 0, max: 1 };
export type SimulationRangeProcessingContext = {
  allRanges: WindowRange[];
  platformContracts: {
    id: number;
    platform: Platform;
    chainId: number;
    version: any;
  }[];
  contractById: Map<
    number,
    { id: number; platform: Platform; chainId: number; version: any }
  >;
};

export type FinalizeSimulationRangeResult = {
  simulation: Simulation | null;
  awaitingEventLogs: boolean;
};

@Injectable()
export class SimulationAutoRunnerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly simulationCacheService: SimulationCacheService,
    private readonly simulationLeaderEvaluatorService: SimulationLeaderEvaluatorService,
    @Inject(SERVICE_NAMES.REDIS_SERVICE)
    private readonly redisClient: ClientProxy,
  ) {}

  private normalizeResearchGroups(value: unknown) {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.map((item: any) =>
      Array.isArray(item?.ranges) ? item : { ranges: [item] },
    );
  }

  static getTerminalStatusForHorizon(input: {
    cursor: Date;
    endAt: Date;
    completedPlans?: number;
    totalSimulationPlans?: number;
  }) {
    if (
      typeof input.completedPlans === 'number' &&
      typeof input.totalSimulationPlans === 'number' &&
      input.totalSimulationPlans > 0 &&
      input.completedPlans >= input.totalSimulationPlans
    ) {
      return SimulationStatus.Completed;
    }

    return input.cursor.getTime() >= input.endAt.getTime()
      ? SimulationStatus.Completed
      : SimulationStatus.Paused;
  }

  mapSimulation(record: any): Simulation {
    const ranges = (value: unknown, fallback: ValueRange) =>
      Array.isArray(value)
        ? (value as ValueRange[])
        : [(value as ValueRange) ?? fallback];

    return {
      ...record,
      trade: ranges(record.trade, DEFAULT_TRADE_RANGE),
      r2: ranges(record.r2, DEFAULT_R2_RANGE),
      slope: ranges(record.slope, DEFAULT_SLOPE_RANGE),
      collateral: ranges(record.collateral, DEFAULT_COLLATERAL_RANGE),
      size: ranges(record.size, DEFAULT_SIZE_RANGE),
      leverage: ranges(record.leverage, DEFAULT_LEVERAGE_RANGE),
      leaderExecutionCollateral: ranges(
        record.leaderExecutionCollateral,
        DEFAULT_COLLATERAL_RANGE,
      ),
      leaderExecutionSize: ranges(
        record.leaderExecutionSize,
        DEFAULT_SIZE_RANGE,
      ),
      leaderExecutionLeverage: ranges(
        record.leaderExecutionLeverage,
        DEFAULT_LEVERAGE_RANGE,
      ),
      followerRiskSize: ranges(record.followerRiskSize, { min: 50, max: 500 }),
      followerRiskCollateral: ranges(record.followerRiskCollateral, {
        min: 10,
        max: 100,
      }),
      score: ranges(record.score, DEFAULT_SCORE_RANGE),
      scoreFormular:
        (record.scoreFormular as SimulationScoreFormular | null) ??
        DEFAULT_SCORE_FORMULAR,
      sizingFormular:
        (record.sizingFormular as SimulationSizingFormular | null) ??
        DEFAULT_SIZING_FORMULAR,
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
      sourceSimulationId: record.sourceSimulationId ?? null,
      title: record.title,
      description: record.description,
      platform: record.platform,
      startAt: record.startAt,
      endAt: record.endAt,
      days: record.days ?? 1,
      gapDays: record.gapDays ?? 0,
      direction: record.direction,
      trade: this.normalizeResearchGroups(record.trade),
      r2: this.normalizeResearchGroups(record.r2),
      slope: this.normalizeResearchGroups(record.slope),
      collateral: this.normalizeResearchGroups(record.collateral),
      size: this.normalizeResearchGroups(record.size),
      leverage: this.normalizeResearchGroups(record.leverage),
      leaderExecutionCollateral: this.normalizeResearchGroups(
        record.leaderExecutionCollateral,
      ),
      leaderExecutionSize: this.normalizeResearchGroups(
        record.leaderExecutionSize,
      ),
      leaderExecutionLeverage: this.normalizeResearchGroups(
        record.leaderExecutionLeverage,
      ),
      followerRiskSize: this.normalizeResearchGroups(record.followerRiskSize),
      followerRiskCollateral: this.normalizeResearchGroups(
        record.followerRiskCollateral,
      ),
      score: this.normalizeResearchGroups(record.score),
      scoreFormular:
        (record.scoreFormular as SimulationScoreFormular | null) ??
        DEFAULT_SCORE_FORMULAR,
      sizingFormular:
        (record.sizingFormular as SimulationSizingFormular | null) ??
        DEFAULT_SIZING_FORMULAR,
      status: record.status ?? SimulationStatus.Created,
      cursor: record.cursor ?? null,
      progressPhase: record.progressPhase ?? 'created',
      progressMessage: record.progressMessage ?? 'Research created',
      progressPercent: record.progressPercent ?? 0,
      totalRanges:
        record.totalRanges ??
        Math.max(
          ...simulations.map(
            (simulation: { totalSimulationPlans?: number | null }) =>
              simulation.totalSimulationPlans ?? 0,
          ),
          0,
        ),
      completedRanges: record.completedRanges ?? 0,
      totalPlans:
        record.totalPlans ??
        simulations.reduce(
          (
            total: number,
            simulation: { totalSimulationPlans?: number | null },
          ) => total + (simulation.totalSimulationPlans ?? 0),
          0,
        ),
      completedPlans:
        record.completedPlans ??
        simulations.reduce(
          (total: number, simulation: { completedPlans?: number | null }) =>
            total + (simulation.completedPlans ?? 0),
          0,
        ),
      outstandingPlans: record.outstandingPlans ?? 0,
      queuedPlans: record.queuedPlans ?? 0,
      runningPlans: record.runningPlans ?? 0,
      finalizingPlans: record.finalizingPlans ?? 0,
      startedAt: record.startedAt ?? null,
      finishedAt: record.finishedAt ?? null,
      lastError: record.lastError ?? null,
      retryAttempts: record.retryAttempts ?? 0,
      nextRetryAt: record.nextRetryAt ?? null,
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

  async loadSimulationRangeProcessingContext(
    platform: Platform,
    allRanges: WindowRange[],
  ): Promise<SimulationRangeProcessingContext> {
    const platformContracts = await this.prisma.contract.findMany({
      where: { platform },
      orderBy: [{ chainId: 'asc' }, { id: 'asc' }],
    });

    if (platformContracts.length === 0) {
      throw new Error(`No contracts found for platform ${platform}`);
    }

    return {
      allRanges,
      platformContracts,
      contractById: new Map(
        platformContracts.map((contract) => [contract.id, contract]),
      ),
    };
  }

  async findCandidateLeadersForRange(simulationId: number, range: WindowRange) {
    const record = await this.prisma.simulation.findUnique({
      where: { id: simulationId },
    });
    const simulation = record ? this.mapSimulation(record) : null;
    if (!simulation || simulation.status === SimulationStatus.Cancelled) {
      return null;
    }
    const candidateLeaders =
      await this.simulationLeaderEvaluatorService.findCandidateLeaders(
        simulation,
        range,
      );
    return { simulation, candidateLeaders };
  }

  async finalizeSimulationRange(
    simulationId: number,
    range: WindowRange,
    context: SimulationRangeProcessingContext,
    evaluatedCandidates: CandidateEvaluation[],
  ): Promise<FinalizeSimulationRangeResult> {
    const record = await this.prisma.simulation.findUnique({
      where: { id: simulationId },
    });
    const simulation = record ? this.mapSimulation(record) : null;
    if (!simulation || simulation.status === SimulationStatus.Cancelled) {
      return { simulation: null, awaitingEventLogs: false };
    }
    const simulationPlan = await this.createSimulationPlanForRange(
      simulation,
      range,
    );
    const cacheCompleted = await this.createSimulationBotsForSelections(
      simulationPlan.id,
      range.startedAt,
      range.endedAt,
      simulation,
      [...evaluatedCandidates].sort((a, b) => b.score - a.score),
      context.platformContracts,
    );
    if (!cacheCompleted) {
      return { simulation: null, awaitingEventLogs: true };
    }

    const plans = await this.prisma.simulationPlan.findMany({
      where: { simulationId },
      select: { startAt: true, endAt: true },
      orderBy: [{ startAt: 'asc' }, { id: 'asc' }],
    });
    const completedRangeKeys = new Set(
      plans.map(
        (plan) => `${plan.startAt.toISOString()}:${plan.endAt.toISOString()}`,
      ),
    );
    let cursor: Date | null = null;
    for (const item of context.allRanges) {
      if (
        !completedRangeKeys.has(
          `${item.startedAt.toISOString()}:${item.endedAt.toISOString()}`,
        )
      )
        break;
      cursor = item.endedAt;
    }
    const completedPlans = plans.length;
    const completed = completedPlans >= context.allRanges.length;
    const updated = await this.prisma.simulation.update({
      where: { id: simulationId },
      data: {
        cursor,
        completedPlans,
        status: completed
          ? SimulationStatus.Completed
          : SimulationStatus.Running,
        progressPhase: completed ? 'completed' : 'plan-window-completed',
        progressMessage: completed
          ? 'Simulation result completed'
          : `Completed ${completedPlans} / ${context.allRanges.length} plan windows`,
        progressPercent: context.allRanges.length
          ? (completedPlans / context.allRanges.length) * 100
          : 100,
      },
    });
    await this.emitSimulationUpdated(updated);
    await this.aggregateSimulation(simulationId, {
      status: completed ? SimulationStatus.Completed : SimulationStatus.Running,
    });
    return {
      simulation: this.mapSimulation(updated),
      awaitingEventLogs: false,
    };
  }

  private async getSimulationPlanForUpdate(id: number) {
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

    await this.redisClient.emit(PATTERNS.Simulations.SimulationPlanUpdated, {
      ...simulationPlan,
      simulationBots: simulationPlan.simulationBots.map((bot) =>
        mapSimulationBotConfiguration(bot),
      ),
    });
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
      return (
        await this.simulationCacheService.rebuildPlanCache(simulationPlanId)
      ).completed;
    }
    const normalizedSimulation = this.mapSimulation(simulation);

    const existingBotCount = await this.prisma.simulationBot.count({
      where: { simulationPlanId },
    });

    if (existingBotCount > 0) {
      return (
        await this.simulationCacheService.refreshIncompleteBotsForPlan(
          simulationPlanId,
        )
      ).completed;
    }

    const hasPlatformContract = contracts.some(
      (contract) => contract.platform === normalizedSimulation.platform,
    );

    if (!hasPlatformContract) {
      return (
        await this.simulationCacheService.rebuildPlanCache(simulationPlanId)
      ).completed;
    }

    const botInputs = selectedCandidates.map((candidate) => ({
      leaderAddress: candidate.leaderAddress,
      leaderPlatform: normalizedSimulation.platform,
      simulationPlanId,
      startedAt,
      stoppedAt,
      mode: normalizedSimulation.direction,
      ratio: candidate.suggestedRatio,
      score: candidate.score,
      minCollateral: Math.min(
        ...normalizedSimulation.leaderExecutionCollateral.map(
          (range) => range.min,
        ),
      ),
      maxCollateral: Math.max(
        ...normalizedSimulation.leaderExecutionCollateral.map(
          (range) => range.max,
        ),
      ),
      minSize: Math.min(
        ...normalizedSimulation.leaderExecutionSize.map((range) => range.min),
      ),
      maxSize: Math.max(
        ...normalizedSimulation.leaderExecutionSize.map((range) => range.max),
      ),
      minLeverage: Math.min(
        ...normalizedSimulation.leaderExecutionLeverage.map(
          (range) => range.min,
        ),
      ),
      maxLeverage: Math.max(
        ...normalizedSimulation.leaderExecutionLeverage.map(
          (range) => range.max,
        ),
      ),
      leaderExecutionCollateral: serializeValueRanges(
        normalizedSimulation.leaderExecutionCollateral,
      ),
      leaderExecutionSize: serializeValueRanges(
        normalizedSimulation.leaderExecutionSize,
      ),
      leaderExecutionLeverage: serializeValueRanges(
        normalizedSimulation.leaderExecutionLeverage,
      ),
      followerRiskSize: serializeValueRanges(
        normalizedSimulation.followerRiskSize,
      ),
      followerRiskCollateral: serializeValueRanges(
        normalizedSimulation.followerRiskCollateral,
      ),
      evaluationTradeCount: candidate.rawTradeCount,
      evaluationSlope: candidate.rawSlope,
      evaluationR2: candidate.rawR2,
      evaluationCopiedPnlUsd: candidate.copiedNetPnlUsd,
      evaluationProfitFactor: candidate.copiedProfitFactor,
      evaluationMaxDrawdownUsd: candidate.copiedDrawdownUsd,
    }));

    if (botInputs.length === 0) {
      return (
        await this.simulationCacheService.rebuildPlanCache(simulationPlanId)
      ).completed;
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

    const planCache =
      await this.simulationCacheService.refreshIncompleteBotsForPlan(
        simulationPlanId,
      );
    await this.emitSimulationPlanUpdated(simulationPlanId);
    return planCache.completed;
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
      // Finalization now certifies the current plan cache before aggregation.
      // Previous completed plans are immutable, so rebuilding every bot in
      // every prior plan here made N finalized ranges perform O(N²) work.
      if (!plan.cache) {
        throw new Error(`Simulation plan cache not found for plan ${plan.id}`);
      }

      totalLeaderPnl += plan.cache.totalLeaderPnl;

      plan.simulationBots.forEach((bot) => {
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
    const isRunning = options.status === SimulationStatus.Running;

    const updatedSimulation = await this.prisma.simulation.update({
      where: { id },
      data: {
        status: options.status,
        progressPhase: isCompleted
          ? 'completed'
          : isRunning
            ? 'plan-window-completed'
            : 'paused',
        progressMessage: isCompleted
          ? 'Simulation result completed'
          : isRunning
            ? `${plans.length} simulation plans completed`
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
