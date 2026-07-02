import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import dayjs from 'dayjs';

import {
  CreateSimulationPlanInput,
  CreateSimulationBotInput,
  UpdateSimulationBotInput,
  CreateSimulationInput,
  CreateSimulationResearchInput,
  FloatMinMaxInput,
  IntMinMaxInput,
  UpdateSimulationInput,
} from './dto/simulations.input';
import {
  SimulationBot,
  SimulationPlan,
  SimulationPlanDetails,
  SimulationPlanConnection,
  Simulation,
  SimulationConnection,
  SimulationResearch,
  SimulationResearchConnection,
  SimulationResearchDetails,
} from './entities/simulations.entity';

import { PrismaService } from 'src/global/prisma.service';
import { SimulationStatus } from 'generated/prisma/enums';
import { SimulationPlansService } from './simulation-plans.service';
import { mapSimulationPlanWithCache } from './simulation-cache.mapper';
import {
  buildSimulationParameterGrid,
  ValueRange,
} from './simulation-research.utils';
import { PATTERNS, SERVICE_NAMES } from 'src/utils/constants';
import {
  DEFAULT_SCORE_FORMULAR,
  DEFAULT_SIZING_FORMULAR,
  SimulationScoreFormular,
  SimulationSizingFormular,
} from './simulation-formulars';

const API_SIMULATION_SYSTEM_CONFIG = {
  minCollateralUsd: 10,
  maxCollateralUsd: 500,
  minRatio: 0,
} as const;
const DEFAULT_SELECTED_LEADER_COUNT = 10;
const DEFAULT_STANDARD_COLLATERAL_USD = 100;
const DEFAULT_TRADE_RANGE = { min: 3, max: 1000000 };
const DEFAULT_R2_RANGE = { min: 0.5, max: 1 };
const DEFAULT_SLOPE_RANGE = { min: 0, max: 1000000000 };
const DEFAULT_COLLATERAL_RANGE = { min: 0, max: 1000000000 };
const DEFAULT_LEVERAGE_RANGE = { min: 0, max: 50 };
const DEFAULT_SCORE_RANGE = { min: 0, max: 1 };

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
    @Optional()
    @Inject(SERVICE_NAMES.REDIS_SERVICE)
    private readonly redisClient?: ClientProxy,
  ) {}

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

  private validateSimulationInput(input: CreateSimulationInput) {
    if (new Date(input.startAt).getTime() >= new Date(input.endAt).getTime()) {
      throw new Error('Simulation startAt must be before endAt');
    }

    if (
      input.standardCollateralUsd <
        API_SIMULATION_SYSTEM_CONFIG.minCollateralUsd ||
      input.standardCollateralUsd >
        API_SIMULATION_SYSTEM_CONFIG.maxCollateralUsd
    ) {
      throw new Error(
        'standardCollateralUsd must be between system minCollateralUsd and maxCollateralUsd',
      );
    }

    this.validatePlanWindow(input.days ?? 1, input.gapDays ?? 0);
    this.validateIntMinMaxPair('trade', input.trade);
    this.validateFloatMinMaxPair('r2', input.r2, {
      minAllowed: 0,
      maxAllowed: 1,
    });
    this.validateFloatMinMaxPair('slope', input.slope, { minAllowed: 0 });
    this.validateFloatMinMaxPair('collateral', input.collateral, {
      minAllowed: 0,
    });
    this.validateFloatMinMaxPair('leverage', input.leverage, {
      minAllowed: 0,
    });
    this.validateFloatMinMaxPair('score', input.score, {
      minAllowed: 0,
      maxAllowed: 1,
    });
  }

  private validateSimulationUpdate(input: UpdateSimulationInput) {
    if (
      input.standardCollateralUsd !== undefined &&
      input.standardCollateralUsd !== null &&
      (input.standardCollateralUsd <
        API_SIMULATION_SYSTEM_CONFIG.minCollateralUsd ||
        input.standardCollateralUsd >
          API_SIMULATION_SYSTEM_CONFIG.maxCollateralUsd)
    ) {
      throw new Error(
        'standardCollateralUsd must be between system minCollateralUsd and maxCollateralUsd',
      );
    }

    if (input.trade !== undefined && input.trade !== null) {
      this.validateIntMinMaxPair('trade', input.trade);
    }

    if (input.r2 !== undefined && input.r2 !== null) {
      this.validateFloatMinMaxPair('r2', input.r2, {
        minAllowed: 0,
        maxAllowed: 1,
      });
    }

    if (input.slope !== undefined && input.slope !== null) {
      this.validateFloatMinMaxPair('slope', input.slope, {
        minAllowed: 0,
      });
    }

    if (input.leverage !== undefined && input.leverage !== null) {
      this.validateFloatMinMaxPair('leverage', input.leverage, {
        minAllowed: 0,
      });
    }

    if (input.collateral !== undefined && input.collateral !== null) {
      this.validateFloatMinMaxPair('collateral', input.collateral, {
        minAllowed: 0,
      });
    }

    if (input.score !== undefined && input.score !== null) {
      this.validateFloatMinMaxPair('score', input.score, {
        minAllowed: 0,
        maxAllowed: 1,
      });
    }
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

    if (input.score.length === 0) {
      throw new Error('score must contain at least one range');
    }

    input.trade.forEach((range, index) =>
      this.validateMinMaxRange(`trade[${index}]`, range, {
        minAllowed: 1,
        integer: true,
      }),
    );
    input.r2.forEach((range, index) =>
      this.validateMinMaxRange(`r2[${index}]`, range, {
        minAllowed: 0,
        maxAllowed: 1,
      }),
    );
    input.slope.forEach((range, index) =>
      this.validateMinMaxRange(`slope[${index}]`, range, {
        minAllowed: 0,
      }),
    );

    input.leverage.forEach((range, index) =>
      this.validateMinMaxRange(`leverage[${index}]`, range, {
        minAllowed: 0,
      }),
    );

    input.collateral.forEach((range, index) =>
      this.validateMinMaxRange(`collateral[${index}]`, range, {
        minAllowed: 0,
      }),
    );

    input.score.forEach((range, index) =>
      this.validateMinMaxRange(`score[${index}]`, range, {
        minAllowed: 0,
        maxAllowed: 1,
      }),
    );

    this.validatePlanWindow(input.days ?? 1, input.gapDays ?? 0);
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
      collateral: (record.collateral as ValueRange[] | null) ?? [],
      leverage: (record.leverage as ValueRange[] | null) ?? [],
      score: (record.score as ValueRange[] | null) ?? [],
      scoreFormular:
        (record.scoreFormular as SimulationScoreFormular | null) ??
        DEFAULT_SCORE_FORMULAR,
      sizingFormular:
        (record.sizingFormular as SimulationSizingFormular | null) ??
        DEFAULT_SIZING_FORMULAR,
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

  async createSimulationResearch(
    input: CreateSimulationResearchInput,
  ): Promise<SimulationResearch> {
    this.validateSimulationResearchInput(input);
    const trade = input.trade;
    const r2 = input.r2;
    const slope = input.slope;
    const collateral = input.collateral;
    const leverage = input.leverage;
    const score = input.score;

    const combinations = buildSimulationParameterGrid({
      direction: input.direction,
      trade,
      r2,
      slope,
      collateral,
      leverage,
      score,
    });

    if (combinations.length === 0) {
      throw new Error(
        'Simulation research produced no valid parameter combinations',
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

    const research = await this.prisma.$transaction(async (tx) => {
      const createdResearch = await tx.simulationResearch.create({
        data: {
          title: input.title,
          description: input.description,
          platform: input.platform,
          startAt: dayjs(input.startAt).startOf('day').toDate(),
          endAt: dayjs(input.endAt).startOf('day').toDate(),
          days,
          gapDays,
          direction: input.direction,
          trade: this.serializeRanges(trade),
          r2: this.serializeRanges(r2),
          slope: this.serializeRanges(slope),
          collateral: this.serializeRanges(collateral),
          leverage: this.serializeRanges(leverage),
          score: this.serializeRanges(score),
          scoreFormular: input.scoreFormular ?? DEFAULT_SCORE_FORMULAR,
          sizingFormular: input.sizingFormular ?? DEFAULT_SIZING_FORMULAR,
        },
      });

      await tx.simulation.createMany({
        data: combinations.map((combination) => ({
          title: input.title,
          description: input.description,
          platform: input.platform,
          researchId: createdResearch.id,
          direction: combination.direction,
          startAt: dayjs(input.startAt).startOf('day').toDate(),
          endAt: dayjs(input.endAt).startOf('day').toDate(),
          days,
          gapDays,
          status: SimulationStatus.Created,
          progressPhase: 'created',
          progressMessage: 'Simulation created',
          progressPercent: 0,
          totalSimulationPlans,
          selectedLeaderCount: DEFAULT_SELECTED_LEADER_COUNT,
          trade: this.serializeRange(combination.trade),
          r2: this.serializeRange(combination.r2),
          slope: this.serializeRange(combination.slope),
          standardCollateralUsd: DEFAULT_STANDARD_COLLATERAL_USD,
          collateral: this.serializeRange(combination.collateral),
          leverage: this.serializeRange(combination.leverage),
          score: this.serializeRange(combination.score),
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

  async createSimulation(input: CreateSimulationInput): Promise<Simulation> {
    this.validateSimulationInput(input);

    const days = input.days ?? 1;
    const gapDays = input.gapDays ?? 0;
    const totalSimulationPlans = countSimulationPlanWindows(
      input.startAt,
      input.endAt,
      days,
      gapDays,
    );

    const simulation = await this.prisma.simulation.create({
      data: {
        ...input,
        direction: input.direction,
        trade: this.serializeRange(input.trade),
        r2: this.serializeRange(input.r2),
        slope: this.serializeRange(input.slope),
        collateral: this.serializeRange(input.collateral),
        leverage: this.serializeRange(input.leverage),
        score: this.serializeRange(input.score),
        scoreFormular: input.scoreFormular ?? DEFAULT_SCORE_FORMULAR,
        sizingFormular: input.sizingFormular ?? DEFAULT_SIZING_FORMULAR,
        startAt: dayjs(input.startAt).startOf('day').toDate(),
        endAt: dayjs(input.endAt).startOf('day').toDate(),
        days,
        gapDays,
        status: SimulationStatus.Created,
        progressPhase: 'created',
        progressMessage: 'Simulation created',
        progressPercent: 0,
        totalSimulationPlans,
      },
    });

    this.logDebug('Auto simulation created', {
      simulationId: simulation.id,
      platform: simulation.platform,
      startAt: simulation.startAt,
      endAt: simulation.endAt,
      totalSimulationPlans: simulation.totalSimulationPlans,
      trade: simulation.trade,
      r2: simulation.r2,
      slope: simulation.slope,
      minRatio: API_SIMULATION_SYSTEM_CONFIG.minRatio,
    });

    return this.mapSimulation(simulation);
  }

  async updateSimulation(input: UpdateSimulationInput): Promise<Simulation> {
    this.validateSimulationUpdate(input);

    const simulation = await this.prisma.simulation.findUnique({
      where: { id: input.id },
    });

    if (!simulation) {
      throw new Error('Simulation not found');
    }

    if (simulation.status === SimulationStatus.Running) {
      throw new Error('Cannot update a running simulation');
    }

    const updated = await this.prisma.simulation.update({
      where: { id: input.id },
      data: {
        title: input.title ?? undefined,
        description: input.description ?? undefined,
        selectedLeaderCount: input.selectedLeaderCount ?? undefined,
        direction: input.direction ?? undefined,
        trade:
          input.trade !== undefined && input.trade !== null
            ? this.serializeRange(input.trade)
            : undefined,
        r2:
          input.r2 !== undefined && input.r2 !== null
            ? this.serializeRange(input.r2)
            : undefined,
        slope:
          input.slope !== undefined && input.slope !== null
            ? this.serializeRange(input.slope)
            : undefined,
        collateral:
          input.collateral !== undefined && input.collateral !== null
            ? this.serializeRange(input.collateral)
            : undefined,
        leverage:
          input.leverage !== undefined && input.leverage !== null
            ? this.serializeRange(input.leverage)
            : undefined,
        standardCollateralUsd: input.standardCollateralUsd ?? undefined,
        score:
          input.score !== undefined && input.score !== null
            ? this.serializeRange(input.score)
            : undefined,
        scoreFormular: input.scoreFormular ?? undefined,
        sizingFormular: input.sizingFormular ?? undefined,
      },
    });

    const mapped = this.mapSimulation(updated);
    await this.emitSimulationUpdated(mapped);

    return mapped;
  }

  private mapSimulation(record: any): Simulation {
    return {
      ...record,
      days: record.days ?? 1,
      gapDays: record.gapDays ?? 0,
      trade: (record.trade as ValueRange | null) ?? DEFAULT_TRADE_RANGE,
      r2: (record.r2 as ValueRange | null) ?? DEFAULT_R2_RANGE,
      slope: (record.slope as ValueRange | null) ?? DEFAULT_SLOPE_RANGE,
      collateral:
        (record.collateral as ValueRange | null) ?? DEFAULT_COLLATERAL_RANGE,
      leverage:
        (record.leverage as ValueRange | null) ?? DEFAULT_LEVERAGE_RANGE,
      score: (record.score as ValueRange | null) ?? DEFAULT_SCORE_RANGE,
      scoreFormular:
        (record.scoreFormular as SimulationScoreFormular | null) ??
        DEFAULT_SCORE_FORMULAR,
      sizingFormular:
        (record.sizingFormular as SimulationSizingFormular | null) ??
        DEFAULT_SIZING_FORMULAR,
    };
  }

  async getSimulations(
    first: number,
    after: number | null,
  ): Promise<SimulationConnection> {
    const records = await this.prisma.simulation.findMany({
      skip: after ? 1 : undefined,
      take: first,
      cursor: after ? { id: after } : undefined,
      orderBy: [{ id: 'desc' }],
    });

    const edges = records.map((record) => ({
      cursor: record.id,
      node: this.mapSimulation(record),
    }));

    return {
      edges,
      pageInfo: {
        hasNextPage: edges.length === first,
        endCursor: edges.length > 0 ? edges[edges.length - 1].cursor : null,
      },
    };
  }

  async getSimulation(id: number): Promise<Simulation | null> {
    const record = await this.prisma.simulation.findUnique({
      where: { id },
    });

    return record ? this.mapSimulation(record) : null;
  }

  async getSimulationResearches(
    first: number,
    after: number | null,
  ): Promise<SimulationResearchConnection> {
    const records = await this.prisma.simulationResearch.findMany({
      skip: after ? 1 : undefined,
      take: first,
      cursor: after ? { id: after } : undefined,
      orderBy: [{ id: 'desc' }],
      include: {
        simulations: {
          select: {
            status: true,
          },
        },
      },
    });

    const edges = records.map((record) => ({
      cursor: record.id,
      node: this.mapSimulationResearch(record),
    }));

    return {
      edges,
      pageInfo: {
        hasNextPage: edges.length === first,
        endCursor: edges.length > 0 ? edges[edges.length - 1].cursor : null,
      },
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

    return plans.map((plan) => mapSimulationPlanWithCache(plan));
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
        include: {
          simulationPlans: {
            select: { id: true },
          },
        },
      });

      if (!simulation) {
        throw new Error('Simulation not found');
      }

      if (simulation.status === SimulationStatus.Running) {
        throw new Error('Cannot delete a running simulation');
      }

      const simulationPlanIds = simulation.simulationPlans.map(
        (plan) => plan.id,
      );

      if (simulationPlanIds.length > 0) {
        await tx.simulationBot.deleteMany({
          where: { simulationPlanId: { in: simulationPlanIds } },
        });

        await tx.simulationPlan.deleteMany({
          where: { id: { in: simulationPlanIds } },
        });
      }

      await tx.simulation.delete({
        where: { id },
      });
    });

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

    this.logWarn('Auto simulation cancelled', { simulationId: id });

    const mapped = this.mapSimulation(simulation);
    await this.emitSimulationUpdated(mapped);

    return mapped;
  }

  async playAutoSimulation(id: number): Promise<Simulation> {
    const simulation = await this.prisma.simulation.findUnique({
      where: { id },
    });

    if (!simulation) {
      throw new Error('Simulation not found');
    }

    if (simulation.status === SimulationStatus.Cancelled) {
      throw new Error('Cannot queue a cancelled simulation');
    }

    if (simulation.status === SimulationStatus.Completed) {
      return this.mapSimulation(simulation);
    }

    const updated = await this.prisma.simulation.update({
      where: { id },
      data: {
        status:
          simulation.status === SimulationStatus.Running
            ? SimulationStatus.Running
            : SimulationStatus.Paused,
        error: null,
        progressPhase: 'queued',
        progressMessage: 'Simulation queued for analytics automation',
      },
    });

    const mapped = this.mapSimulation(updated);
    await this.emitSimulationUpdated(mapped);

    return mapped;
  }

  async deleteSimulationPlan(id: number): Promise<number> {
    return await this.simulationPlansService.deleteSimulationPlan(id);
  }

  async createSimulationPlan(
    input: CreateSimulationPlanInput,
  ): Promise<SimulationPlan> {
    return await this.simulationPlansService.createSimulationPlan(input);
  }

  async batchCreateSimulationBots(
    inputs: CreateSimulationBotInput[],
  ): Promise<SimulationBot[]> {
    return await this.simulationPlansService.batchCreateSimulationBots(inputs);
  }

  async updateSimulationBot(
    input: UpdateSimulationBotInput,
  ): Promise<SimulationBot> {
    return await this.simulationPlansService.updateSimulationBot(input);
  }

  async playSimulationPlan(id: number): Promise<SimulationPlan> {
    return await this.simulationPlansService.playSimulationPlan(id);
  }

  async stopSimulationBot(id: number): Promise<SimulationBot> {
    return await this.simulationPlansService.stopSimulationBot(id);
  }

  async getSimulationPlans(
    first: number,
    after: number | null,
  ): Promise<SimulationPlanConnection> {
    return await this.simulationPlansService.getSimulationPlans(first, after);
  }

  async getSimulationPlanById(id: number): Promise<SimulationPlanDetails> {
    return await this.simulationPlansService.getSimulationPlanById(id);
  }
}
