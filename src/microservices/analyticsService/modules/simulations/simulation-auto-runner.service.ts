import { Inject, Injectable, Optional } from '@nestjs/common';
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
import { WindowRange } from './utils/simulation-range.utils';
import {
  CandidateEvaluation,
  SimulationLeaderEvaluatorService,
} from './simulation-leader-evaluator.service';
import { DistributedSimulationEvaluatorService } from './distributed-simulation-evaluator.service';
import { SimulationCacheService } from './simulation-cache.service';
import { PATTERNS, SERVICE_NAMES } from 'src/utils/constants';
import {
  SimulationPlan,
  SimulationResearch,
} from 'src/microservices/apiService/modules/simulations/entities/simulations.entity';
import {
  DEFAULT_SCORE_FORMULAR,
  DEFAULT_SIZING_FORMULAR,
  SimulationScoreFormular,
  SimulationSizingFormular,
} from 'src/microservices/apiService/modules/simulations/simulation-formulars';

type ValueRange = {
  min: number;
  max: number;
};

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

@Injectable()
export class SimulationAutoRunnerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly simulationCacheService: SimulationCacheService,
    private readonly simulationLeaderEvaluatorService: SimulationLeaderEvaluatorService,
    @Inject(SERVICE_NAMES.REDIS_SERVICE)
    private readonly redisClient: ClientProxy,
    @Optional()
    private readonly distributedSimulationEvaluatorService?: DistributedSimulationEvaluatorService,
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
      startedAt: record.startedAt ?? null,
      finishedAt: record.finishedAt ?? null,
      lastError: record.lastError ?? null,
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

  async processSimulationRange(
    simulationId: number,
    range: WindowRange,
    context: SimulationRangeProcessingContext,
  ): Promise<Simulation | null> {
    const currentRecord = await this.prisma.simulation.findUnique({
      where: { id: simulationId },
    });
    const current = currentRecord ? this.mapSimulation(currentRecord) : null;

    if (!current || current.status === SimulationStatus.Cancelled) {
      return null;
    }

    const selectingSimulation = await this.prisma.simulation.update({
      where: { id: simulationId },
      data: {
        progressPhase: 'leader-selection',
        progressMessage: `Selecting leaders for ${dayjs(range.startedAt).format(
          'YYYY-MM-DD',
        )}`,
      },
    });
    await this.emitSimulationUpdated(selectingSimulation);

    const simulationPlan = await this.createSimulationPlanForRange(
      current,
      range,
    );

    console.time(`findCandidateLeaders`);

    const candidateLeaders =
      await this.simulationLeaderEvaluatorService.findCandidateLeaders(
        current,
        range,
      );

    console.timeEnd(`findCandidateLeaders`);

    console.time(`evaluateLeadersForRange`);

    const canUseDistributedEvaluator =
      this.distributedSimulationEvaluatorService &&
      (await this.distributedSimulationEvaluatorService.canEvaluateLeadersForRange(
        current,
        range,
      ));

    const evaluatedCandidates = canUseDistributedEvaluator
      ? await this.distributedSimulationEvaluatorService!.evaluateLeadersForRange(
          current,
          candidateLeaders,
          range,
          context.contractById,
        )
      : await this.simulationLeaderEvaluatorService.evaluateLeadersForRange(
          current,
          candidateLeaders,
          range,
          context.contractById,
        );

    console.timeEnd(`evaluateLeadersForRange`);

    const selectedCandidates = evaluatedCandidates.sort(
      (a, b) => b.score - a.score,
    );

    await this.createSimulationBotsForSelections(
      simulationPlan.id,
      range.startedAt,
      range.endedAt,
      current,
      selectedCandidates,
      context.platformContracts,
    );

    const completedPlans = context.allRanges.filter(
      (item) => item.endedAt.getTime() <= range.endedAt.getTime(),
    ).length;

    const completedPlanWindowSimulation = await this.prisma.simulation.update({
      where: { id: simulationId },
      data: {
        cursor: range.endedAt,
        completedPlans,
        progressPhase: 'plan-window-completed',
        progressMessage: `Completed ${dayjs(range.startedAt).format(
          'YYYY-MM-DD',
        )}`,
        progressPercent:
          context.allRanges.length > 0
            ? (completedPlans / context.allRanges.length) * 100
            : 100,
      },
    });
    await this.emitSimulationUpdated(completedPlanWindowSimulation);
    return this.mapSimulation(completedPlanWindowSimulation);
  }

  async aggregateSimulationThroughCursor(id: number, allRanges: WindowRange[]) {
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
        completedPlans: latest.completedPlans,
        totalSimulationPlans: allRanges.length,
      }),
      through: latest.cursor,
    });
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
    const normalizedSimulation = this.mapSimulation(simulation);

    const existingBotCount = await this.prisma.simulationBot.count({
      where: { simulationPlanId },
    });

    if (existingBotCount > 0) {
      return;
    }

    const hasPlatformContract = contracts.some(
      (contract) => contract.platform === normalizedSimulation.platform,
    );

    if (!hasPlatformContract) {
      return;
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
        ...normalizedSimulation.collateral.map((range) => range.min),
      ),
      maxCollateral: Math.max(
        ...normalizedSimulation.collateral.map((range) => range.max),
      ),
      minLeverage: Math.min(
        ...normalizedSimulation.leverage.map((range) => range.min),
      ),
      maxLeverage: Math.max(
        ...normalizedSimulation.leverage.map((range) => range.max),
      ),
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
    await this.emitSimulationPlanUpdated(simulationPlanId);
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
          ? 'Simulation result completed'
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
