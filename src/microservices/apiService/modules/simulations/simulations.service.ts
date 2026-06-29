import { Injectable, Logger } from '@nestjs/common';
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
  SimulationLeaderSelection,
  SimulationResearch,
  SimulationResearchConnection,
  SimulationResearchDetails,
} from './entities/simulations.entity';

import { PrismaService } from 'src/global/prisma.service';
import { SimulationStatus } from 'generated/prisma/enums';
import { SIMULATION_SYSTEM_CONFIG } from './simulation.constants';
import { buildDailyRanges } from './simulation-range.utils';
import {
  buildAutomationHorizon,
  filterReadyAutomationRanges,
  isRunningSimulationStale,
  SIMULATION_AUTOMATION_STALE_AFTER_MS,
} from './simulation-automation-queue.utils';
import { SimulationAutoRunnerService } from './simulation-auto-runner.service';
import { SimulationPlansService } from './simulation-plans.service';
import {
  buildSimulationParameterGrid,
  ValueRange,
} from './simulation-research.utils';

const DEFAULT_SELECTED_LEADER_COUNT = 10;
const DEFAULT_STANDARD_COLLATERAL_USD = 100;
const DEFAULT_TRADE_RANGE = { min: 3, max: 1000000 };
const DEFAULT_R2_RANGE = { min: 0.5, max: 1 };
const DEFAULT_SLOPE_RANGE = { min: 0, max: 1000000000 };

@Injectable()
export class SimulationsService {
  private readonly logger = new Logger(SimulationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly simulationAutoRunnerService: SimulationAutoRunnerService,
    private readonly simulationPlansService: SimulationPlansService,
  ) {}

  static getAutomationStatusPriority(status: SimulationStatus) {
    switch (status) {
      case SimulationStatus.Running:
        return 0;
      case SimulationStatus.Paused:
        return 1;
      case SimulationStatus.Created:
        return 2;
      default:
        return 99;
    }
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

  private validateSimulationInput(input: CreateSimulationInput) {
    if (new Date(input.startAt).getTime() >= new Date(input.endAt).getTime()) {
      throw new Error('Simulation startAt must be before endAt');
    }

    if (
      input.standardCollateralUsd < SIMULATION_SYSTEM_CONFIG.minCollateralUsd ||
      input.standardCollateralUsd > SIMULATION_SYSTEM_CONFIG.maxCollateralUsd
    ) {
      throw new Error(
        'standardCollateralUsd must be between system minCollateralUsd and maxCollateralUsd',
      );
    }

    if (input.maxLeverage <= 0) {
      throw new Error('maxLeverage must be greater than 0');
    }

    this.validateIntMinMaxPair('trade', input.trade);
    this.validateFloatMinMaxPair('r2', input.r2, {
      minAllowed: 0,
      maxAllowed: 1,
    });
    this.validateFloatMinMaxPair('slope', input.slope, { minAllowed: 0 });
  }

  private validateSimulationUpdate(input: UpdateSimulationInput) {
    if (
      input.standardCollateralUsd !== undefined &&
      input.standardCollateralUsd !== null &&
      (input.standardCollateralUsd <
        SIMULATION_SYSTEM_CONFIG.minCollateralUsd ||
        input.standardCollateralUsd > SIMULATION_SYSTEM_CONFIG.maxCollateralUsd)
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

    if (input.maxLeverage.length === 0) {
      throw new Error('maxLeverage must contain at least one value');
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

    input.maxLeverage.forEach((value, index) => {
      if (value < 0) {
        throw new Error(
          `maxLeverage[${index}] must be greater than or equal to 0`,
        );
      }
    });
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

  private serializeNumbers(values: number[]) {
    return values.map((value) => value) as any;
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
      direction: record.direction,
      trade: record.trade as any,
      r2: record.r2 as any,
      slope: record.slope as any,
      maxLeverage: (record.maxLeverage as number[] | null) ?? [],
      totalSimulations,
      completedSimulations,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  async createSimulationResearch(
    input: CreateSimulationResearchInput,
  ): Promise<SimulationResearch> {
    this.validateSimulationResearchInput(input);
    const trade = input.trade;
    const r2 = input.r2;
    const slope = input.slope;
    const maxLeverage = input.maxLeverage;

    const combinations = buildSimulationParameterGrid({
      direction: input.direction,
      trade,
      r2,
      slope,
      maxLeverage,
    });

    if (combinations.length === 0) {
      throw new Error(
        'Simulation research produced no valid parameter combinations',
      );
    }

    const totalSimulationPlans = buildDailyRanges(
      input.startAt,
      input.endAt,
    ).length;

    const research = await this.prisma.$transaction(async (tx) => {
      const createdResearch = await tx.simulationResearch.create({
        data: {
          title: input.title,
          description: input.description,
          platform: input.platform,
          startAt: dayjs(input.startAt).startOf('day').toDate(),
          endAt: dayjs(input.endAt).startOf('day').toDate(),
          direction: input.direction,
          trade: this.serializeRanges(trade),
          r2: this.serializeRanges(r2),
          slope: this.serializeRanges(slope),
          maxLeverage: this.serializeNumbers(maxLeverage),
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
          maxLeverage: combination.maxLeverage,
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

    const totalSimulationPlans = buildDailyRanges(
      input.startAt,
      input.endAt,
    ).length;

    const simulation = await this.prisma.simulation.create({
      data: {
        ...input,
        direction: input.direction,
        trade: this.serializeRange(input.trade),
        r2: this.serializeRange(input.r2),
        slope: this.serializeRange(input.slope),
        startAt: dayjs(input.startAt).startOf('day').toDate(),
        endAt: dayjs(input.endAt).startOf('day').toDate(),
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
      minRatio: SIMULATION_SYSTEM_CONFIG.minRatio,
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
        standardCollateralUsd: input.standardCollateralUsd ?? undefined,
        maxLeverage: input.maxLeverage ?? undefined,
      },
    });

    return this.mapSimulation(updated);
  }

  private mapSimulation(record: any): Simulation {
    return {
      ...record,
      trade: (record.trade as ValueRange | null) ?? DEFAULT_TRADE_RANGE,
      r2: (record.r2 as ValueRange | null) ?? DEFAULT_R2_RANGE,
      slope: (record.slope as ValueRange | null) ?? DEFAULT_SLOPE_RANGE,
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
    return await this.prisma.simulationPlan.findMany({
      where: { simulationId },
      orderBy: [{ startAt: 'asc' }, { id: 'asc' }],
      include: {
        simulationBots: {
          include: {
            leaderContract: true,
          },
        },
      },
    });
  }

  async getSimulationPlanDetailsBySimulation(
    simulationId: number,
  ): Promise<SimulationPlanDetails[]> {
    return await this.simulationPlansService.getSimulationPlanDetailsBySimulation(
      simulationId,
    );
  }

  async getSimulationLeaderSelections(
    simulationId: number,
    simulationPlanId: number | null,
  ): Promise<SimulationLeaderSelection[]> {
    return await this.prisma.simulationLeaderSelection.findMany({
      where: {
        simulationId,
        simulationPlanId: simulationPlanId ?? undefined,
      },
      orderBy: [{ date: 'asc' }, { score: 'desc' }],
    });
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

      await tx.simulationLeaderSelection.deleteMany({
        where: {
          OR: [
            { simulationId: id },
            ...(simulationPlanIds.length > 0
              ? [{ simulationPlanId: { in: simulationPlanIds } }]
              : []),
          ],
        },
      });

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

    this.simulationAutoRunnerService.clearActiveRun(id);

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

    return this.mapSimulation(simulation);
  }

  async playAutoSimulation(id: number): Promise<Simulation> {
    return await this.simulationAutoRunnerService.playAutoSimulation(id);
  }

  async processNextQueuedAutoSimulation(
    now = new Date(),
  ): Promise<Simulation | null> {
    const candidates = await this.prisma.simulation.findMany({
      where: {
        status: {
          in: [
            SimulationStatus.Running,
            SimulationStatus.Paused,
            SimulationStatus.Created,
          ],
        },
      },
      orderBy: [{ updatedAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      take: 25,
    });

    const eligibleCandidates = candidates
      .filter((candidate) => {
        if (
          candidate.status === SimulationStatus.Running &&
          !isRunningSimulationStale({
            status: candidate.status,
            updatedAt: candidate.updatedAt,
            now,
            staleAfterMs: SIMULATION_AUTOMATION_STALE_AFTER_MS,
            isLocallyActive:
              this.simulationAutoRunnerService.isAutoSimulationActive(
                candidate.id,
              ),
          })
        ) {
          return false;
        }

        const allRanges = buildDailyRanges(candidate.startAt, candidate.endAt);
        const horizon = buildAutomationHorizon(candidate.endAt, now);
        const readyRanges = filterReadyAutomationRanges(
          allRanges,
          candidate.cursor,
          horizon,
        );

        return readyRanges.length > 0;
      })
      .sort((a, b) => {
        const priorityDiff =
          SimulationsService.getAutomationStatusPriority(a.status) -
          SimulationsService.getAutomationStatusPriority(b.status);

        if (priorityDiff !== 0) {
          return priorityDiff;
        }

        return a.updatedAt.getTime() - b.updatedAt.getTime();
      });

    const simulation = eligibleCandidates[0];

    if (!simulation) {
      return null;
    }

    const horizon = buildAutomationHorizon(simulation.endAt, now);

    return this.simulationAutoRunnerService.playQueuedAutoSimulation(
      simulation.id,
      horizon,
    );
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
