import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import dayjs from 'dayjs';

import {
  CreateSimulationResearchInput,
  UpdateSimulationResearchInput,
  FloatMinMaxInput,
  IntMinMaxInput,
  FloatRangeGroupInput,
} from './dto/simulations.input';
import {
  SimulationPlanDetails,
  Simulation,
  SimulationPlan,
  SimulationResearch,
  SimulationResearchPage,
  SimulationResearchDetails,
} from './entities/simulations.entity';

import { PrismaService } from 'src/global/prisma.service';
import { SimulationWorkflowConfigService } from 'src/global/simulation-workflow-config.service';
import {
  SimulationEvaluatorTaskStatus,
  SimulationExecutionPlanStatus,
  SimulationStatus,
} from 'generated/prisma/enums';
import { SimulationPlansService } from './simulation-plans.service';
import { mapSimulationPlanWithCache } from './simulation-cache.mapper';
import { mapSimulationBotConfiguration } from './simulation-bot-config.mapper';
import {
  buildSimulationParameterGrid,
  buildLayerVariantParameterGrid,
  RangeGroup,
  ValueRange,
} from './simulation-research.utils';
import { PATTERNS, SERVICE_NAMES } from 'src/utils/constants';
import {
  DEFAULT_SCORE_FORMULAR,
  DEFAULT_SIZING_FORMULAR,
  SimulationScoreFormular,
  SimulationSizingFormular,
} from './simulation-formulars';
import {
  calculateMaxDrawdown,
  calculateProfitFactor,
  cumulative,
} from 'src/microservices/analyticsService/modules/simulations/utils/simulation-automation.utils';

const DEFAULT_SELECTED_LEADER_COUNT = 10;
const DEFAULT_STANDARD_COLLATERAL_USD = 100;
const DEFAULT_TRADE_RANGE = { min: 3, max: 1000000 };
const DEFAULT_R2_RANGE = { min: 0.5, max: 1 };
const DEFAULT_SLOPE_RANGE = { min: 0, max: 1000000000 };
const DEFAULT_COLLATERAL_RANGE = { min: 0, max: 1000000000 };
const DEFAULT_SIZE_RANGE = { min: 0, max: 1000000000 };
const DEFAULT_LEVERAGE_RANGE = { min: 0, max: 50 };
const DEFAULT_SCORE_RANGE = { min: 0, max: 1 };
// Research deletion can cascade through plans, bots, and their cached event logs.
// Prisma's 5-second default is too short for larger completed researches.
const SIMULATION_DELETION_TRANSACTION_OPTIONS = {
  maxWait: 10_000,
  timeout: 30_000,
} as const;

function countSimulationPlanWindows(
  startAt: Date,
  endAt: Date,
  days: number,
  gapDays: number,
) {
  let count = 0;
  let cursor = dayjs(startAt).startOf('day');
  const end = dayjs(endAt).startOf('day');

  while (cursor.isBefore(end)) {
    const nextCursor = cursor.add(days, 'day');

    if (nextCursor.isAfter(end)) {
      break;
    }

    count += 1;
    cursor = nextCursor.add(gapDays, 'day');
  }

  return count;
}

@Injectable()
export class SimulationsService {
  private readonly logger = new Logger(SimulationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly simulationPlansService: SimulationPlansService,
    private readonly workflowConfig: SimulationWorkflowConfigService,
    @Optional()
    @Inject(SERVICE_NAMES.REDIS_SERVICE)
    private readonly redisClient?: ClientProxy,
  ) {}

  private logWarn(message: string, metadata?: Record<string, unknown>) {
    this.logger.warn(
      metadata ? `${message} ${JSON.stringify(metadata)}` : message,
    );
  }

  private validateIntMinMaxPair(name: string, range: IntMinMaxInput) {
    if (!Number.isInteger(range.min) || !Number.isInteger(range.max)) {
      throw new Error(`${name} must use integer values`);
    }

    if (range.min <= 0) {
      throw new Error(`${name}.min must be greater than 0`);
    }

    if (range.max < range.min) {
      throw new Error(`${name}.max must be greater than or equal to min`);
    }
  }

  private validateIntMinMaxPairs(name: string, ranges: IntMinMaxInput[]) {
    if (ranges.length === 0) {
      throw new Error(`${name} must contain at least one range`);
    }

    ranges.forEach((range, index) => {
      if (!Number.isInteger(range.min) || !Number.isInteger(range.max)) {
        throw new Error(`${name}[${index}] must use integer values`);
      }

      if (range.min <= 0) {
        throw new Error(`${name}[${index}].min must be greater than 0`);
      }

      if (range.max < range.min) {
        throw new Error(
          `${name}[${index}].max must be greater than or equal to min`,
        );
      }
    });
  }

  private validateFloatMinMaxPair(
    name: string,
    range: FloatMinMaxInput,
    options: { minAllowed?: number; maxAllowed?: number } = {},
  ) {
    if (options.minAllowed !== undefined && range.min < options.minAllowed) {
      throw new Error(
        `${name}.min must be greater than or equal to ${options.minAllowed}`,
      );
    }

    if (options.maxAllowed !== undefined && range.max > options.maxAllowed) {
      throw new Error(
        `${name}.max must be less than or equal to ${options.maxAllowed}`,
      );
    }

    if (range.max < range.min) {
      throw new Error(`${name}.max must be greater than or equal to min`);
    }
  }

  private validateFloatMinMaxPairs(
    name: string,
    ranges: FloatMinMaxInput[],
    options: { minAllowed?: number; maxAllowed?: number } = {},
  ) {
    if (ranges.length === 0) {
      throw new Error(`${name} must contain at least one range`);
    }

    ranges.forEach((range, index) => {
      if (options.minAllowed !== undefined && range.min < options.minAllowed) {
        throw new Error(
          `${name}[${index}].min must be greater than or equal to ${options.minAllowed}`,
        );
      }

      if (options.maxAllowed !== undefined && range.max > options.maxAllowed) {
        throw new Error(
          `${name}[${index}].max must be less than or equal to ${options.maxAllowed}`,
        );
      }

      if (range.max < range.min) {
        throw new Error(
          `${name}[${index}].max must be greater than or equal to min`,
        );
      }
    });
  }

  private validateMinMaxRange(
    name: string,
    range: IntMinMaxInput | FloatMinMaxInput,
    options: {
      minAllowed?: number;
      maxAllowed?: number;
      integer?: boolean;
    } = {},
  ) {
    if (range.max < range.min) {
      throw new Error(`${name} max must be greater than or equal to min`);
    }

    if (options.integer) {
      if (!Number.isInteger(range.min) || !Number.isInteger(range.max)) {
        throw new Error(`${name} must use integer values`);
      }
    }

    if (options.minAllowed !== undefined && range.min < options.minAllowed) {
      throw new Error(
        `${name} min must be greater than or equal to ${options.minAllowed}`,
      );
    }

    if (options.maxAllowed !== undefined && range.max > options.maxAllowed) {
      throw new Error(
        `${name} max must be less than or equal to ${options.maxAllowed}`,
      );
    }
  }

  private validateSimulationResearchInput(
    input: CreateSimulationResearchInput,
  ) {
    if (new Date(input.startAt).getTime() >= new Date(input.endAt).getTime()) {
      throw new Error('Simulation research startAt must be before endAt');
    }

    if (input.trade.length === 0) {
      throw new Error('trade must contain at least one range');
    }

    if (input.r2.length === 0) {
      throw new Error('r2 must contain at least one range');
    }

    if (input.slope.length === 0) {
      throw new Error('slope must contain at least one range');
    }

    if (input.leverage.length === 0) {
      throw new Error('leverage must contain at least one range');
    }

    if (input.collateral.length === 0) {
      throw new Error('collateral must contain at least one range');
    }

    if (input.size.length === 0) {
      throw new Error('size must contain at least one range');
    }

    if (input.score.length === 0) {
      throw new Error('score must contain at least one range');
    }

    if (
      input.leaderExecutionCollateral.length === 0 ||
      input.leaderExecutionSize.length === 0 ||
      input.leaderExecutionLeverage.length === 0
    ) {
      throw new Error(
        'leader execution collateral, size, and leverage must each contain at least one range',
      );
    }

    const validateGroups = (
      name: string,
      groups: Array<{ ranges: ValueRange[] }>,
      options: { minAllowed?: number; maxAllowed?: number; integer?: boolean },
    ) =>
      groups.forEach((group, groupIndex) => {
        if (group.ranges.length === 0) {
          throw new Error(
            `${name}[${groupIndex}] must contain at least one range`,
          );
        }
        group.ranges.forEach((range, rangeIndex) =>
          this.validateMinMaxRange(
            `${name}[${groupIndex}].ranges[${rangeIndex}]`,
            range,
            options,
          ),
        );
      });

    validateGroups('trade', input.trade, {
      minAllowed: 1,
      integer: true,
    });
    validateGroups('r2', input.r2, {
      minAllowed: 0,
      maxAllowed: 1,
    });
    validateGroups('slope', input.slope, {
      minAllowed: 0,
    });
    validateGroups('leverage', input.leverage, {
      minAllowed: 0,
    });
    validateGroups('collateral', input.collateral, {
      minAllowed: 0,
    });
    validateGroups('size', input.size, {
      minAllowed: 0,
    });
    validateGroups('score', input.score, {
      minAllowed: 0,
      maxAllowed: 1,
    });
    validateGroups(
      'leaderExecutionCollateral',
      input.leaderExecutionCollateral,
      { minAllowed: 0 },
    );
    validateGroups('leaderExecutionSize', input.leaderExecutionSize, {
      minAllowed: 0,
    });
    validateGroups('leaderExecutionLeverage', input.leaderExecutionLeverage, {
      minAllowed: 0,
    });
    this.validateFollowerRisk(
      input.followerRiskSize,
      input.followerRiskCollateral,
    );

    this.validatePlanWindow(input.days ?? 1, input.gapDays ?? 0);
  }

  private validateFollowerRisk(
    followerRiskSize: FloatRangeGroupInput[],
    followerRiskCollateral: FloatRangeGroupInput[],
  ) {
    const validate = (name: string, groups: FloatRangeGroupInput[]) =>
      this.validateFloatMinMaxPairs(
        `followerRisk.${name}`,
        groups.flatMap((group) => group.ranges),
        { minAllowed: 0 },
      );
    validate('size', followerRiskSize);
    validate('collateral', followerRiskCollateral);
  }

  private validatePlanWindow(days: number, gapDays: number) {
    if (!Number.isInteger(days) || days <= 0) {
      throw new Error('days must be a positive integer');
    }

    if (!Number.isInteger(gapDays) || gapDays < 0) {
      throw new Error('gapDays must be a non-negative integer');
    }
  }

  private serializeRanges(ranges: Array<{ min: number; max: number }>) {
    return ranges.map((range) => ({
      min: range.min,
      max: range.max,
    })) as any;
  }

  private serializeRangeGroups(groups: RangeGroup[]) {
    return groups.map((group) => ({
      ranges: this.serializeRanges(group.ranges),
    })) as any;
  }

  private normalizeSimulationRanges(value: unknown, fallback: ValueRange) {
    if (Array.isArray(value)) {
      return value as ValueRange[];
    }

    return [(value as ValueRange | null) ?? fallback];
  }

  private normalizeResearchGroups(value: unknown) {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.map((item) =>
      item &&
      typeof item === 'object' &&
      Array.isArray((item as RangeGroup).ranges)
        ? item
        : { ranges: [item] },
    ) as RangeGroup[];
  }

  private serializeRange(range: { min: number; max: number }) {
    return {
      min: range.min,
      max: range.max,
    } as any;
  }

  private mapSimulationResearch(record: any): SimulationResearch {
    const simulations = record.simulations || [];
    const totalSimulations = simulations.length;
    const completedSimulations = simulations.filter(
      (simulation: { status: SimulationStatus }) =>
        simulation.status === SimulationStatus.Completed,
    ).length;
    const days = record.days ?? 1;
    const gapDays = record.gapDays ?? 0;
    const totalRanges =
      record.totalRanges ??
      countSimulationPlanWindows(record.startAt, record.endAt, days, gapDays);

    return {
      id: record.id,
      sourceSimulationId: record.sourceSimulationId ?? null,
      title: record.title,
      description: record.description,
      platform: record.platform,
      startAt: record.startAt,
      endAt: record.endAt,
      days,
      gapDays,
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
      totalRanges,
      completedRanges: record.completedRanges ?? 0,
      totalPlans:
        record.totalPlans ??
        simulations.reduce(
          (
            total: number,
            simulation: { totalSimulationPlans?: number | null },
          ) => total + (simulation.totalSimulationPlans ?? totalRanges),
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

  private async emitSimulationResearchUpdated(id: number) {
    if (!this.redisClient) {
      return;
    }

    const research = await this.prisma.simulationResearch.findUnique({
      where: { id },
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

  private async emitSimulationUpdated(simulation: Simulation) {
    if (!this.redisClient) {
      return;
    }

    await this.redisClient.emit(
      PATTERNS.Simulations.SimulationUpdated,
      simulation,
    );

    if (simulation.researchId) {
      await this.emitSimulationResearchUpdated(simulation.researchId);
    }
  }

  private async deleteSimulationRecordsInTransaction(
    tx: any,
    simulationIds: number[],
  ) {
    if (simulationIds.length === 0) {
      return;
    }

    const simulationPlans = await tx.simulationPlan.findMany({
      where: { simulationId: { in: simulationIds } },
      select: { id: true },
    });
    const simulationPlanIds = simulationPlans.map(
      (plan: { id: number }) => plan.id,
    );

    if (simulationPlanIds.length > 0) {
      await tx.simulationBot.deleteMany({
        where: { simulationPlanId: { in: simulationPlanIds } },
      });

      await tx.simulationPlan.deleteMany({
        where: { id: { in: simulationPlanIds } },
      });
    }

    await tx.simulation.deleteMany({
      where: { id: { in: simulationIds } },
    });
  }

  async createSimulationResearch(
    input: CreateSimulationResearchInput,
  ): Promise<SimulationResearch> {
    this.validateSimulationResearchInput(input);
    const trade = input.trade;
    const r2 = input.r2;
    const slope = input.slope;
    const collateral = input.collateral;
    const size = input.size;
    const leverage = input.leverage;
    const leaderExecutionCollateral = input.leaderExecutionCollateral;
    const leaderExecutionSize = input.leaderExecutionSize;
    const leaderExecutionLeverage = input.leaderExecutionLeverage;
    const score = input.score;

    const combinations = buildSimulationParameterGrid({
      direction: input.direction,
      trade,
      r2,
      slope,
      collateral,
      size,
      leverage,
      leaderExecutionCollateral,
      leaderExecutionSize,
      leaderExecutionLeverage,
      followerRiskSize: input.followerRiskSize,
      followerRiskCollateral: input.followerRiskCollateral,
      score,
    });

    if (combinations.length === 0) {
      throw new Error(
        'Simulation research produced no valid parameter combinations',
      );
    }

    const workflow = await this.workflowConfig.get();
    if (combinations.length > workflow.maxSimulationsPerResearch) {
      throw new Error(
        `Simulation research can generate at most ${workflow.maxSimulationsPerResearch} simulations`,
      );
    }

    const days = input.days ?? 1;
    const gapDays = input.gapDays ?? 0;
    const totalSimulationPlans = countSimulationPlanWindows(
      input.startAt,
      input.endAt,
      days,
      gapDays,
    );
    const normalizedStartAt = dayjs(input.startAt).startOf('day').toDate();
    const normalizedEndAt = dayjs(input.endAt).startOf('day').toDate();
    const research = await this.prisma.$transaction(async (tx) => {
      const createdResearch = await tx.simulationResearch.create({
        data: {
          title: input.title,
          description: input.description,
          platform: input.platform,
          startAt: normalizedStartAt,
          endAt: normalizedEndAt,
          days,
          gapDays,
          direction: input.direction,
          trade: this.serializeRangeGroups(trade),
          r2: this.serializeRangeGroups(r2),
          slope: this.serializeRangeGroups(slope),
          collateral: this.serializeRangeGroups(collateral),
          size: this.serializeRangeGroups(size),
          leverage: this.serializeRangeGroups(leverage),
          leaderExecutionCollateral: this.serializeRangeGroups(
            leaderExecutionCollateral,
          ),
          leaderExecutionSize: this.serializeRangeGroups(leaderExecutionSize),
          leaderExecutionLeverage: this.serializeRangeGroups(
            leaderExecutionLeverage,
          ),
          followerRiskSize: this.serializeRangeGroups(input.followerRiskSize),
          followerRiskCollateral: this.serializeRangeGroups(
            input.followerRiskCollateral,
          ),
          score: this.serializeRangeGroups(score),
          scoreFormular: input.scoreFormular ?? DEFAULT_SCORE_FORMULAR,
          sizingFormular: input.sizingFormular ?? DEFAULT_SIZING_FORMULAR,
          status: SimulationStatus.Created,
          progressPhase: 'created',
          progressMessage: 'Research created',
          progressPercent: 0,
          totalRanges: totalSimulationPlans,
          completedRanges: 0,
          totalPlans: totalSimulationPlans * combinations.length,
          completedPlans: 0,
        },
      });

      await tx.simulation.createMany({
        data: combinations.map((combination) => ({
          title: input.title,
          description: input.description,
          platform: input.platform,
          researchId: createdResearch.id,
          direction: combination.direction,
          startAt: normalizedStartAt,
          endAt: normalizedEndAt,
          days,
          gapDays,
          status: SimulationStatus.Created,
          progressPhase: 'created',
          progressMessage: 'Simulation created',
          progressPercent: 0,
          totalSimulationPlans,
          selectedLeaderCount: DEFAULT_SELECTED_LEADER_COUNT,
          trade: this.serializeRanges(combination.trade),
          r2: this.serializeRanges(combination.r2),
          slope: this.serializeRanges(combination.slope),
          standardCollateralUsd: DEFAULT_STANDARD_COLLATERAL_USD,
          collateral: this.serializeRanges(combination.collateral),
          size: this.serializeRanges(combination.size),
          leverage: this.serializeRanges(combination.leverage),
          leaderExecutionCollateral: this.serializeRanges(
            combination.leaderExecutionCollateral,
          ),
          leaderExecutionSize: this.serializeRanges(
            combination.leaderExecutionSize,
          ),
          leaderExecutionLeverage: this.serializeRanges(
            combination.leaderExecutionLeverage,
          ),
          followerRiskSize: this.serializeRanges(combination.followerRiskSize),
          followerRiskCollateral: this.serializeRanges(
            combination.followerRiskCollateral,
          ),
          score: this.serializeRanges(combination.score),
          scoreFormular: input.scoreFormular ?? DEFAULT_SCORE_FORMULAR,
          sizingFormular: input.sizingFormular ?? DEFAULT_SIZING_FORMULAR,
        })),
      });

      return tx.simulationResearch.findUniqueOrThrow({
        where: { id: createdResearch.id },
        include: {
          simulations: {
            select: {
              status: true,
            },
          },
        },
      });
    });

    return this.mapSimulationResearch(research);
  }

  async createSimulationResearchFromSimulation(
    sourceSimulationId: number,
    input: CreateSimulationResearchInput,
  ): Promise<SimulationResearch> {
    const title = input.title.trim();
    const description = input.description.trim();
    if (!title || !description) {
      throw new Error('Simulation research title and description are required');
    }

    const validateGroups = (name: string, groups: FloatRangeGroupInput[]) => {
      if (
        groups.length === 0 ||
        groups.some((group) => group.ranges.length === 0)
      ) {
        throw new Error(`${name} must contain at least one range group`);
      }
      this.validateFloatMinMaxPairs(
        name,
        groups.flatMap((group) => group.ranges),
        { minAllowed: 0 },
      );
    };

    validateGroups(
      'leaderExecutionCollateral',
      input.leaderExecutionCollateral,
    );
    validateGroups('leaderExecutionSize', input.leaderExecutionSize);
    validateGroups('leaderExecutionLeverage', input.leaderExecutionLeverage);
    validateGroups('followerRiskSize', input.followerRiskSize);
    validateGroups('followerRiskCollateral', input.followerRiskCollateral);

    const sourceSimulation = await this.prisma.simulation.findUnique({
      where: { id: sourceSimulationId },
      include: {
        simulationPlans: {
          orderBy: [{ startAt: 'asc' }, { id: 'asc' }],
          include: {
            simulationBots: {
              orderBy: { id: 'asc' },
              include: {
                cache: {
                  select: {
                    completed: true,
                    eventSnapshotVersion: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!sourceSimulation) {
      throw new Error('Source simulation not found');
    }
    if (sourceSimulation.status !== SimulationStatus.Completed) {
      throw new Error('Layer 1 can only be reused from a completed simulation');
    }
    if (sourceSimulation.simulationPlans.length === 0) {
      throw new Error('Source simulation has no plans to reuse');
    }
    const sourceBots = sourceSimulation.simulationPlans.flatMap(
      (plan) => plan.simulationBots,
    );
    const missingSnapshot = sourceBots.find(
      (bot) => !bot.cache?.completed || bot.cache.eventSnapshotVersion < 2,
    );
    if (missingSnapshot) {
      throw new Error(
        `Source simulation bot ${missingSnapshot.id} has no complete Layer 1 event snapshot`,
      );
    }

    const variants = buildLayerVariantParameterGrid(input);
    const workflow = await this.workflowConfig.get();
    if (variants.length > workflow.maxSimulationsPerResearch) {
      throw new Error(
        `Layer variant can generate at most ${workflow.maxSimulationsPerResearch} simulations`,
      );
    }

    const totalPlans =
      sourceSimulation.simulationPlans.length * variants.length;
    const startedAt = new Date();

    const created = await this.prisma.$transaction(async (tx) => {
      const research = await tx.simulationResearch.create({
        data: {
          title,
          description,
          platform: sourceSimulation.platform,
          startAt: sourceSimulation.startAt,
          endAt: sourceSimulation.endAt,
          days: sourceSimulation.days,
          gapDays: sourceSimulation.gapDays,
          direction: sourceSimulation.direction,
          trade: this.normalizeResearchGroups(sourceSimulation.trade) as any,
          r2: this.normalizeResearchGroups(sourceSimulation.r2) as any,
          slope: this.normalizeResearchGroups(sourceSimulation.slope) as any,
          collateral: this.normalizeResearchGroups(
            sourceSimulation.collateral,
          ) as any,
          size: this.normalizeResearchGroups(sourceSimulation.size) as any,
          leverage: this.normalizeResearchGroups(
            sourceSimulation.leverage,
          ) as any,
          score: this.normalizeResearchGroups(sourceSimulation.score) as any,
          scoreFormular: sourceSimulation.scoreFormular,
          sizingFormular: sourceSimulation.sizingFormular,
          leaderExecutionCollateral: this.serializeRangeGroups(
            input.leaderExecutionCollateral,
          ),
          leaderExecutionSize: this.serializeRangeGroups(
            input.leaderExecutionSize,
          ),
          leaderExecutionLeverage: this.serializeRangeGroups(
            input.leaderExecutionLeverage,
          ),
          followerRiskSize: this.serializeRangeGroups(input.followerRiskSize),
          followerRiskCollateral: this.serializeRangeGroups(
            input.followerRiskCollateral,
          ),
          sourceSimulationId: sourceSimulation.id,
          automationEnabled: false,
          status: SimulationStatus.Running,
          progressPhase: 'recalculating-layer-2-3',
          progressMessage: 'Reusing Layer 1 leader evaluations',
          progressPercent: 0,
          totalRanges: sourceSimulation.simulationPlans.length,
          totalPlans,
          startedAt,
        },
      });

      const simulations: Array<{ id: number; planIds: number[] }> = [];
      for (const variant of variants) {
        const simulation = await tx.simulation.create({
          data: {
            title,
            description,
            platform: sourceSimulation.platform,
            researchId: research.id,
            sourceSimulationId: sourceSimulation.id,
            direction: sourceSimulation.direction,
            startAt: sourceSimulation.startAt,
            endAt: sourceSimulation.endAt,
            days: sourceSimulation.days,
            gapDays: sourceSimulation.gapDays,
            cursor: sourceSimulation.cursor,
            status: SimulationStatus.Running,
            progressPhase: 'recalculating-layer-2-3',
            progressMessage: 'Recalculating follower positions',
            totalSimulationPlans: sourceSimulation.simulationPlans.length,
            selectedLeaderCount: sourceSimulation.selectedLeaderCount,
            trade: sourceSimulation.trade as any,
            r2: sourceSimulation.r2 as any,
            slope: sourceSimulation.slope as any,
            standardCollateralUsd: sourceSimulation.standardCollateralUsd,
            collateral: sourceSimulation.collateral as any,
            size: sourceSimulation.size as any,
            leverage: sourceSimulation.leverage as any,
            score: sourceSimulation.score as any,
            scoreFormular: sourceSimulation.scoreFormular,
            sizingFormular: sourceSimulation.sizingFormular,
            leaderExecutionCollateral: this.serializeRanges(
              variant.leaderExecutionCollateral,
            ),
            leaderExecutionSize: this.serializeRanges(
              variant.leaderExecutionSize,
            ),
            leaderExecutionLeverage: this.serializeRanges(
              variant.leaderExecutionLeverage,
            ),
            followerRiskSize: this.serializeRanges(variant.followerRiskSize),
            followerRiskCollateral: this.serializeRanges(
              variant.followerRiskCollateral,
            ),
          },
        });
        const planIds: number[] = [];

        for (const sourcePlan of sourceSimulation.simulationPlans) {
          const plan = await tx.simulationPlan.create({
            data: {
              title: `${title} ${dayjs(sourcePlan.startAt).format('YYYY-MM-DD')}`,
              description,
              startAt: sourcePlan.startAt,
              endAt: sourcePlan.endAt,
              cursor: sourcePlan.cursor,
              simulationId: simulation.id,
              sourceSimulationPlanId: sourcePlan.id,
            },
          });
          planIds.push(plan.id);

          if (sourcePlan.simulationBots.length > 0) {
            await tx.simulationBot.createMany({
              data: sourcePlan.simulationBots.map((sourceBot) => ({
                sourceSimulationBotId: sourceBot.id,
                leaderAddress: sourceBot.leaderAddress,
                leaderPlatform: sourceBot.leaderPlatform,
                simulationPlanId: plan.id,
                startedAt: sourceBot.startedAt,
                stoppedAt: sourceBot.stoppedAt,
                mode: sourceBot.mode,
                ratio: sourceBot.ratio,
                score: sourceBot.score,
                minCollateral: Math.min(
                  ...variant.leaderExecutionCollateral.map(
                    (range) => range.min,
                  ),
                ),
                maxCollateral: Math.max(
                  ...variant.leaderExecutionCollateral.map(
                    (range) => range.max,
                  ),
                ),
                minSize: Math.min(
                  ...variant.leaderExecutionSize.map((range) => range.min),
                ),
                maxSize: Math.max(
                  ...variant.leaderExecutionSize.map((range) => range.max),
                ),
                minLeverage: Math.min(
                  ...variant.leaderExecutionLeverage.map((range) => range.min),
                ),
                maxLeverage: Math.max(
                  ...variant.leaderExecutionLeverage.map((range) => range.max),
                ),
                leaderExecutionCollateral: this.serializeRanges(
                  variant.leaderExecutionCollateral,
                ),
                leaderExecutionSize: this.serializeRanges(
                  variant.leaderExecutionSize,
                ),
                leaderExecutionLeverage: this.serializeRanges(
                  variant.leaderExecutionLeverage,
                ),
                followerRiskSize: this.serializeRanges(
                  variant.followerRiskSize,
                ),
                followerRiskCollateral: this.serializeRanges(
                  variant.followerRiskCollateral,
                ),
                evaluationTradeCount: sourceBot.evaluationTradeCount,
                evaluationSlope: sourceBot.evaluationSlope,
                evaluationR2: sourceBot.evaluationR2,
                evaluationCopiedPnlUsd: sourceBot.evaluationCopiedPnlUsd,
                evaluationProfitFactor: sourceBot.evaluationProfitFactor,
                evaluationMaxDrawdownUsd: sourceBot.evaluationMaxDrawdownUsd,
              })),
            });
          }
        }

        simulations.push({ id: simulation.id, planIds });
      }

      return { research, simulations };
    });

    try {
      for (let index = 0; index < created.simulations.length; index++) {
        const simulation = created.simulations[index];
        const followerPositionPnls: number[] = [];
        let totalLeaderPnl = 0;
        let totalFollowerPnl = 0;

        for (const planId of simulation.planIds) {
          const details =
            await this.simulationPlansService.calculateSimulationPlanDetails(
              planId,
              { eventSource: 'sourceSnapshot' },
            );
          totalLeaderPnl += details.totalLeaderPnl;
          totalFollowerPnl += details.totalFollowerPnl;

          for (const bot of details.simulationBots) {
            const botPnls = bot.positions.map(
              (position) => position.followerPnl,
            );
            followerPositionPnls.push(...botPnls);
            await this.prisma.simulationBotCache.upsert({
              where: { simulationBotId: bot.id },
              create: {
                simulationBotId: bot.id,
                completed: true,
                lastFetchedAt: new Date(),
                openedPositions: bot.openedPositions,
                totalPositions: bot.totalPositions,
                totalLeaderPnl: bot.totalPnl,
                totalFollowerPnl: botPnls.reduce((sum, pnl) => sum + pnl, 0),
                maxDuration: bot.maxDuration,
                avgDuration: bot.avgDuration,
                avgPnl: bot.avgPnl,
                avgPositivePnl: bot.avgPositivePnl,
                avgNegativePnl: bot.avgNegativePnl,
                avgSize: bot.avgSize,
                avgCollateral: bot.avgCollateral,
                avgPnlPercentageBySize: bot.avgPnlPercentageBySize,
                avgPnlPercentageByCollateral: bot.avgPnlPercentageByCollateral,
                avgLeverage: bot.avgLeverage,
                positionsJson: JSON.stringify(bot.positions),
                followerPositionPnlsJson: JSON.stringify(botPnls),
              },
              update: {},
            });
          }

          await this.prisma.simulationPlanCache.upsert({
            where: { simulationPlanId: planId },
            create: {
              simulationPlanId: planId,
              completed: true,
              completedBots: details.simulationBots.length,
              incompleteBots: 0,
              openedPositions: details.openedPositions,
              totalPositions: details.totalPositions,
              totalLeaderPnl: details.totalLeaderPnl,
              totalFollowerPnl: details.totalFollowerPnl,
              lastBuiltAt: new Date(),
            },
            update: {},
          });
        }

        const tradeCount = followerPositionPnls.length;
        const positiveTrades = followerPositionPnls.filter(
          (pnl) => pnl > 0,
        ).length;
        await this.prisma.simulation.update({
          where: { id: simulation.id },
          data: {
            status: SimulationStatus.Completed,
            progressPhase: 'completed',
            progressMessage: 'Layer 2/3 variant recalculation completed',
            progressPercent: 100,
            completedPlans: simulation.planIds.length,
            totalLeaderPnl,
            totalFollowerPnl,
            totalNetPnlUsd: totalFollowerPnl,
            totalCostUsd: 0,
            tradeCount,
            winRate: tradeCount > 0 ? positiveTrades / tradeCount : 0,
            profitFactor: calculateProfitFactor(followerPositionPnls),
            maxDrawdownUsd: calculateMaxDrawdown(
              cumulative(followerPositionPnls),
            ),
          },
        });

        await this.prisma.simulationResearch.update({
          where: { id: created.research.id },
          data: {
            completedPlans: { increment: simulation.planIds.length },
            progressPercent: ((index + 1) / created.simulations.length) * 100,
            progressMessage: `Recalculated ${index + 1} / ${created.simulations.length} simulations`,
          },
        });
      }

      const completed = await this.prisma.simulationResearch.update({
        where: { id: created.research.id },
        data: {
          status: SimulationStatus.Completed,
          progressPhase: 'completed',
          progressMessage: 'Layer 2/3 variant completed from shared Layer 1',
          progressPercent: 100,
          completedRanges: sourceSimulation.simulationPlans.length,
          finishedAt: new Date(),
        },
        include: { simulations: { select: { status: true } } },
      });
      return this.mapSimulationResearch(completed);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      await this.prisma.simulation.updateMany({
        where: {
          researchId: created.research.id,
          status: { not: SimulationStatus.Completed },
        },
        data: {
          status: SimulationStatus.Failed,
          progressPhase: 'layer-2-3-recalculation-failed',
          progressMessage: 'Layer 2/3 recalculation failed',
          error: errorMessage,
        },
      });
      const completedSimulations = await this.prisma.simulation.count({
        where: {
          researchId: created.research.id,
          status: SimulationStatus.Completed,
        },
      });
      const failed = await this.prisma.simulationResearch.update({
        where: { id: created.research.id },
        data: {
          status: SimulationStatus.Failed,
          progressPhase: 'layer-2-3-recalculation-failed',
          progressMessage:
            completedSimulations > 0
              ? `${completedSimulations} variant(s) completed before recalculation failed; remaining variants were marked failed`
              : 'Layer 2/3 variant recalculation failed; all variants were marked failed',
          progressPercent:
            (completedSimulations / created.simulations.length) * 100,
          lastError: errorMessage,
          finishedAt: new Date(),
        },
        include: { simulations: { select: { status: true } } },
      });
      return this.mapSimulationResearch(failed);
    }
  }

  async updateSimulationResearch(
    input: UpdateSimulationResearchInput,
  ): Promise<SimulationResearch> {
    const title = input.title.trim();
    const description = input.description.trim();

    if (!title || !description) {
      throw new Error('Simulation research title and description are required');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const research = await tx.simulationResearch.findUnique({
        where: { id: input.id },
        include: { simulations: { select: { id: true } } },
      });

      if (!research) {
        throw new Error('Simulation research not found');
      }

      const simulationIds = research.simulations.map(
        (simulation) => simulation.id,
      );
      await tx.simulationResearch.update({
        where: { id: input.id },
        data: { title, description },
      });

      if (simulationIds.length > 0) {
        await tx.simulation.updateMany({
          where: { id: { in: simulationIds } },
          data: { title, description },
        });

        const plans = await tx.simulationPlan.findMany({
          where: { simulationId: { in: simulationIds } },
          select: { id: true, startAt: true },
        });
        await Promise.all(
          plans.map((plan) =>
            tx.simulationPlan.update({
              where: { id: plan.id },
              data: {
                title: `${title} ${dayjs(plan.startAt).format('YYYY-MM-DD')}`,
                description,
              },
            }),
          ),
        );
      }

      return tx.simulationResearch.findUniqueOrThrow({
        where: { id: input.id },
        include: { simulations: true },
      });
    });

    await this.emitSimulationResearchUpdated(input.id);
    await Promise.all(
      updated.simulations.map((simulation) =>
        this.emitSimulationUpdated(this.mapSimulation(simulation)),
      ),
    );

    return this.mapSimulationResearch(updated);
  }

  private mapSimulation(record: any): Simulation {
    return {
      ...record,
      days: record.days ?? 1,
      gapDays: record.gapDays ?? 0,
      trade: this.normalizeSimulationRanges(record.trade, DEFAULT_TRADE_RANGE),
      r2: this.normalizeSimulationRanges(record.r2, DEFAULT_R2_RANGE),
      slope: this.normalizeSimulationRanges(record.slope, DEFAULT_SLOPE_RANGE),
      collateral: this.normalizeSimulationRanges(
        record.collateral,
        DEFAULT_COLLATERAL_RANGE,
      ),
      size: this.normalizeSimulationRanges(record.size, DEFAULT_SIZE_RANGE),
      leverage: this.normalizeSimulationRanges(
        record.leverage,
        DEFAULT_LEVERAGE_RANGE,
      ),
      leaderExecutionCollateral: this.normalizeSimulationRanges(
        record.leaderExecutionCollateral,
        DEFAULT_COLLATERAL_RANGE,
      ),
      leaderExecutionSize: this.normalizeSimulationRanges(
        record.leaderExecutionSize,
        DEFAULT_SIZE_RANGE,
      ),
      leaderExecutionLeverage: this.normalizeSimulationRanges(
        record.leaderExecutionLeverage,
        DEFAULT_LEVERAGE_RANGE,
      ),
      followerRiskSize: this.normalizeSimulationRanges(
        record.followerRiskSize,
        {
          min: 50,
          max: 500,
        },
      ),
      followerRiskCollateral: this.normalizeSimulationRanges(
        record.followerRiskCollateral,
        {
          min: 10,
          max: 100,
        },
      ),
      score: this.normalizeSimulationRanges(record.score, DEFAULT_SCORE_RANGE),
      scoreFormular:
        (record.scoreFormular as SimulationScoreFormular | null) ??
        DEFAULT_SCORE_FORMULAR,
      sizingFormular:
        (record.sizingFormular as SimulationSizingFormular | null) ??
        DEFAULT_SIZING_FORMULAR,
    };
  }

  async getSimulation(id: number): Promise<Simulation | null> {
    const record = await this.prisma.simulation.findUnique({
      where: { id },
    });

    return record ? this.mapSimulation(record) : null;
  }

  async getSimulationResearches(
    offset: number,
    limit: number,
  ): Promise<SimulationResearchPage> {
    if (!Number.isInteger(offset) || offset < 0) {
      throw new Error('offset must be a non-negative integer');
    }

    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error('limit must be an integer between 1 and 100');
    }

    const [records, total] = await Promise.all([
      this.prisma.simulationResearch.findMany({
        skip: offset,
        take: limit,
        orderBy: [{ id: 'desc' }],
        include: {
          simulations: {
            select: {
              status: true,
            },
          },
        },
      }),
      this.prisma.simulationResearch.count(),
    ]);

    return {
      items: records.map((record) => this.mapSimulationResearch(record)),
      total,
      offset,
      limit,
    };
  }

  async getSimulationResearch(
    id: number,
  ): Promise<SimulationResearchDetails | null> {
    const record = await this.prisma.simulationResearch.findUnique({
      where: { id },
      include: {
        simulations: {
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        },
      },
    });

    if (!record) {
      return null;
    }

    return {
      ...this.mapSimulationResearch(record),
      simulations: record.simulations.map((simulation) =>
        this.mapSimulation(simulation),
      ),
    };
  }

  async getSimulationsByResearch(researchId: number): Promise<Simulation[]> {
    const records = await this.prisma.simulation.findMany({
      where: { researchId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    return records.map((record) => this.mapSimulation(record));
  }

  async getSimulationPlansBySimulation(
    simulationId: number,
  ): Promise<SimulationPlan[]> {
    const plans = await this.prisma.simulationPlan.findMany({
      where: { simulationId },
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

    return plans.map((plan) => ({
      ...mapSimulationPlanWithCache(plan),
      simulationBots: plan.simulationBots.map((bot) =>
        mapSimulationBotConfiguration(bot),
      ),
    }));
  }

  async getSimulationPlanDetailsBySimulation(
    simulationId: number,
  ): Promise<SimulationPlanDetails[]> {
    return await this.simulationPlansService.getSimulationPlanDetailsBySimulation(
      simulationId,
    );
  }

  async deleteSimulation(id: number): Promise<number> {
    await this.prisma.$transaction(async (tx) => {
      const simulation = await tx.simulation.findUnique({
        where: { id },
      });

      if (!simulation) {
        throw new Error('Simulation not found');
      }

      if (simulation.status === SimulationStatus.Running) {
        throw new Error('Cannot delete a running simulation');
      }

      await this.deleteSimulationRecordsInTransaction(tx, [id]);
    }, SIMULATION_DELETION_TRANSACTION_OPTIONS);

    return id;
  }

  async deleteSimulationResearch(id: number): Promise<number> {
    await this.prisma.$transaction(async (tx) => {
      const research = await tx.simulationResearch.findUnique({
        where: { id },
        include: {
          simulations: {
            select: {
              id: true,
              status: true,
            },
          },
        },
      });

      if (!research) {
        throw new Error('SimulationResearch not found');
      }

      if (
        research.simulations.some(
          (simulation: { status: SimulationStatus }) =>
            simulation.status === SimulationStatus.Running,
        )
      ) {
        throw new Error('Cannot delete research with a running simulation');
      }

      await this.deleteSimulationRecordsInTransaction(
        tx,
        research.simulations.map((simulation: { id: number }) => simulation.id),
      );

      await tx.simulationResearch.delete({
        where: { id },
      });
    }, SIMULATION_DELETION_TRANSACTION_OPTIONS);

    return id;
  }

  async cancelSimulation(id: number): Promise<Simulation> {
    const simulation = await this.prisma.simulation.update({
      where: { id },
      data: {
        status: SimulationStatus.Cancelled,
        progressPhase: 'cancelled',
        progressMessage: 'Simulation cancellation requested',
      },
    });

    this.logWarn('Simulation cancelled', { simulationId: id });

    const mapped = this.mapSimulation(simulation);
    await this.emitSimulationUpdated(mapped);

    return mapped;
  }

  async playAutoResearch(id: number): Promise<SimulationResearch> {
    return this.queueResearch(id, false);
  }

  async resumeResearch(id: number): Promise<SimulationResearch> {
    return this.queueResearch(id, true);
  }

  /** Admin escape hatch for failed plans left behind by an interrupted run. */
  async recoverResearch(id: number): Promise<SimulationResearch> {
    const now = new Date();
    const recovered = await this.prisma.$transaction(async (tx) => {
      const research = await tx.simulationResearch.findUnique({
        where: { id },
        include: { simulations: { select: { status: true } } },
      });
      if (!research) throw new Error('SimulationResearch not found');
      if (research.status === SimulationStatus.Cancelled) {
        throw new Error('Cannot recover cancelled research');
      }

      await tx.simulationExecutionPlan.updateMany({
        where: {
          simulation: { is: { researchId: id } },
          status: SimulationExecutionPlanStatus.Failed,
        },
        data: {
          status: SimulationExecutionPlanStatus.Pending,
          evaluatorTaskId: null,
          leaseToken: null,
          leaseExpiresAt: null,
          attempts: 0,
          lastError: 'Reset by an administrator for recovery',
        },
      });
      // Never take an active lease away from a live finalizer, but release a
      // stale one so the dispatcher can reclaim it immediately.
      await tx.simulationExecutionPlan.updateMany({
        where: {
          simulation: { is: { researchId: id } },
          status: SimulationExecutionPlanStatus.Finalizing,
          leaseExpiresAt: { lte: now },
        },
        data: {
          status: SimulationExecutionPlanStatus.Dispatched,
          leaseToken: null,
          leaseExpiresAt: null,
          nextFinalizationAt: now,
          lastError: 'Expired finalizer lease reset by an administrator',
        },
      });
      await tx.simulation.updateMany({
        where: { researchId: id, status: SimulationStatus.Failed },
        data: {
          status: SimulationStatus.Running,
          progressPhase: 'dynamic-plan-scheduling',
          progressMessage: 'Recovered by an administrator; awaiting scheduler',
        },
      });
      return tx.simulationResearch.update({
        where: { id },
        data: {
          status: SimulationStatus.Running,
          automationEnabled: true,
          automationLeaseToken: null,
          automationLeaseExpiresAt: null,
          lastError: null,
          retryAttempts: 0,
          nextRetryAt: null,
          progressPhase: 'dynamic-plan-scheduling',
          progressMessage: 'Recovery requested; reconciling simulation plans',
        },
        include: { simulations: { select: { status: true } } },
      });
    });

    await this.emitSimulationResearchUpdated(id);
    return this.mapSimulationResearch(recovered);
  }

  private async queueResearch(
    id: number,
    allowFailed: boolean,
  ): Promise<SimulationResearch> {
    const research = await this.prisma.simulationResearch.findUnique({
      where: { id },
      include: {
        simulations: {
          select: {
            status: true,
          },
        },
      },
    });

    if (!research) {
      throw new Error('SimulationResearch not found');
    }

    if (research.status === SimulationStatus.Running) {
      throw new Error('Cannot queue a running research');
    }

    if (research.status === SimulationStatus.Completed) {
      throw new Error('Cannot queue a completed research');
    }

    if (research.status === SimulationStatus.Cancelled) {
      throw new Error('Cannot queue a cancelled research');
    }

    if (research.status === SimulationStatus.Failed && !allowFailed) {
      throw new Error('Cannot queue a failed research');
    }

    if (research.status === SimulationStatus.Queued) {
      return this.mapSimulationResearch(research);
    }

    const updated = await this.prisma.simulationResearch.update({
      where: { id },
      data: {
        status: SimulationStatus.Queued,
        automationEnabled: true,
        automationLeaseToken: null,
        automationLeaseExpiresAt: null,
        lastError: null,
        retryAttempts: 0,
        nextRetryAt: null,
        progressPhase: 'queued',
        progressMessage: 'Research queued for analytics automation',
      },
      include: {
        simulations: {
          select: {
            status: true,
          },
        },
      },
    });

    const mapped = this.mapSimulationResearch(updated);
    await this.emitSimulationResearchUpdated(id);

    return mapped;
  }

  async restartResearch(id: number): Promise<SimulationResearch> {
    const restarted = await this.prisma.$transaction(async (tx) => {
      const research = await tx.simulationResearch.findUnique({
        where: { id },
        include: { simulations: { select: { id: true, status: true } } },
      });
      if (!research) throw new Error('SimulationResearch not found');
      if (research.status === SimulationStatus.Running) {
        throw new Error('Cannot restart a running research');
      }
      if (research.status === SimulationStatus.Cancelled) {
        throw new Error('Cannot restart a cancelled research');
      }

      await this.deleteSimulationRecordsInTransaction(
        tx,
        research.simulations.map((simulation) => simulation.id),
      );

      const combinations = buildSimulationParameterGrid({
        direction: research.direction,
        trade: this.normalizeResearchGroups(research.trade),
        r2: this.normalizeResearchGroups(research.r2),
        slope: this.normalizeResearchGroups(research.slope),
        collateral: this.normalizeResearchGroups(research.collateral),
        size: this.normalizeResearchGroups(research.size),
        leverage: this.normalizeResearchGroups(research.leverage),
        leaderExecutionCollateral: this.normalizeResearchGroups(
          research.leaderExecutionCollateral,
        ),
        leaderExecutionSize: this.normalizeResearchGroups(
          research.leaderExecutionSize,
        ),
        leaderExecutionLeverage: this.normalizeResearchGroups(
          research.leaderExecutionLeverage,
        ),
        followerRiskSize: this.normalizeResearchGroups(
          research.followerRiskSize,
        ),
        followerRiskCollateral: this.normalizeResearchGroups(
          research.followerRiskCollateral,
        ),
        score: this.normalizeResearchGroups(research.score),
      });
      const totalSimulationPlans = countSimulationPlanWindows(
        research.startAt,
        research.endAt,
        research.days,
        research.gapDays,
      );
      await tx.simulation.createMany({
        data: combinations.map((combination) => ({
          title: research.title,
          description: research.description,
          platform: research.platform,
          researchId: research.id,
          direction: combination.direction,
          startAt: research.startAt,
          endAt: research.endAt,
          days: research.days,
          gapDays: research.gapDays,
          status: SimulationStatus.Created,
          progressPhase: 'created',
          progressMessage: 'Simulation restarted',
          progressPercent: 0,
          totalSimulationPlans,
          selectedLeaderCount: DEFAULT_SELECTED_LEADER_COUNT,
          trade: this.serializeRanges(combination.trade),
          r2: this.serializeRanges(combination.r2),
          slope: this.serializeRanges(combination.slope),
          standardCollateralUsd: DEFAULT_STANDARD_COLLATERAL_USD,
          collateral: this.serializeRanges(combination.collateral),
          size: this.serializeRanges(combination.size),
          leverage: this.serializeRanges(combination.leverage),
          leaderExecutionCollateral: this.serializeRanges(
            combination.leaderExecutionCollateral,
          ),
          leaderExecutionSize: this.serializeRanges(
            combination.leaderExecutionSize,
          ),
          leaderExecutionLeverage: this.serializeRanges(
            combination.leaderExecutionLeverage,
          ),
          followerRiskSize: this.serializeRanges(combination.followerRiskSize),
          followerRiskCollateral: this.serializeRanges(
            combination.followerRiskCollateral,
          ),
          score: this.serializeRanges(combination.score),
          scoreFormular: research.scoreFormular,
          sizingFormular: research.sizingFormular,
        })),
      });
      return tx.simulationResearch.update({
        where: { id },
        data: {
          cursor: null,
          status: SimulationStatus.Queued,
          automationEnabled: true,
          automationLeaseToken: null,
          automationLeaseExpiresAt: null,
          startedAt: null,
          finishedAt: null,
          lastError: null,
          retryAttempts: 0,
          nextRetryAt: null,
          progressPhase: 'queued',
          progressMessage: 'Research restarted and queued for automation',
          progressPercent: 0,
          totalRanges: totalSimulationPlans,
          completedRanges: 0,
          totalPlans: totalSimulationPlans * combinations.length,
          completedPlans: 0,
        },
        include: { simulations: { select: { status: true } } },
      });
    }, SIMULATION_DELETION_TRANSACTION_OPTIONS);

    await this.emitSimulationResearchUpdated(id);
    return this.mapSimulationResearch(restarted);
  }

  async pauseResearch(id: number): Promise<SimulationResearch> {
    const research = await this.prisma.simulationResearch.findUnique({
      where: { id },
      include: {
        simulations: {
          select: {
            status: true,
          },
        },
      },
    });

    if (!research) {
      throw new Error('SimulationResearch not found');
    }

    if (research.status === SimulationStatus.Completed) {
      throw new Error('Cannot pause a completed research');
    }

    if (research.status === SimulationStatus.Cancelled) {
      throw new Error('Cannot pause a cancelled research');
    }

    if (research.status === SimulationStatus.Failed) {
      throw new Error('Cannot pause a failed research');
    }

    if (research.status === SimulationStatus.Paused) {
      return this.mapSimulationResearch(research);
    }

    const updated = await this.prisma.simulationResearch.update({
      where: { id },
      data: {
        status: SimulationStatus.Paused,
        automationEnabled: false,
        automationLeaseToken: null,
        automationLeaseExpiresAt: null,
        progressPhase: 'paused',
        progressMessage: 'Research automation paused',
      },
      include: {
        simulations: {
          select: {
            status: true,
          },
        },
      },
    });

    const mapped = this.mapSimulationResearch(updated);
    await this.emitSimulationResearchUpdated(id);

    return mapped;
  }

  async cancelResearch(id: number): Promise<SimulationResearch> {
    const research = await this.prisma.simulationResearch.findUnique({
      where: { id },
      include: {
        simulations: {
          select: {
            status: true,
          },
        },
      },
    });

    if (!research) {
      throw new Error('SimulationResearch not found');
    }

    if (research.status === SimulationStatus.Completed) {
      throw new Error('Cannot cancel a completed research');
    }

    if (research.status === SimulationStatus.Cancelled) {
      return this.mapSimulationResearch(research);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.simulationEvaluatorTask.updateMany({
        where: {
          simulation: { is: { researchId: id } },
          status: {
            in: [
              SimulationEvaluatorTaskStatus.Queued,
              SimulationEvaluatorTaskStatus.Ready,
            ],
          },
        },
        data: {
          status: SimulationEvaluatorTaskStatus.Cancelled,
          dedupeKey: null,
          completedAt: new Date(),
          lastError: 'Cancelled with simulation research',
        },
      });
      await tx.simulationExecutionPlan.updateMany({
        where: {
          simulation: { is: { researchId: id } },
          status: {
            in: [
              SimulationExecutionPlanStatus.Pending,
              SimulationExecutionPlanStatus.Dispatched,
              SimulationExecutionPlanStatus.AwaitingEventLogs,
              SimulationExecutionPlanStatus.Finalizing,
              SimulationExecutionPlanStatus.Failed,
            ],
          },
        },
        data: {
          status: SimulationExecutionPlanStatus.Cancelled,
          leaseToken: null,
          leaseExpiresAt: null,
          lastError: 'Cancelled with simulation research',
        },
      });
      await tx.simulation.updateMany({
        where: {
          researchId: id,
          status: {
            notIn: [SimulationStatus.Completed, SimulationStatus.Cancelled],
          },
        },
        data: {
          status: SimulationStatus.Cancelled,
          progressPhase: 'cancelled',
          progressMessage: 'Cancelled with simulation research',
        },
      });
      return tx.simulationResearch.update({
        where: { id },
        data: {
          status: SimulationStatus.Cancelled,
          automationEnabled: false,
          progressPhase: 'cancelled',
          progressMessage: 'Research cancelled',
          outstandingPlans: 0,
          queuedPlans: 0,
          runningPlans: 0,
          finalizingPlans: 0,
          finishedAt: new Date(),
        },
        include: { simulations: { select: { status: true } } },
      });
    });

    const mapped = this.mapSimulationResearch(updated);
    await this.emitSimulationResearchUpdated(id);

    return mapped;
  }

  async getSimulationPlanById(id: number): Promise<SimulationPlanDetails> {
    return await this.simulationPlansService.getSimulationPlanById(id);
  }
}
