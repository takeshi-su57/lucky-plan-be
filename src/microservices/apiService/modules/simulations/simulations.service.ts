import { Injectable, Logger } from '@nestjs/common';
import dayjs from 'dayjs';

import {
  CreateSimulationPlanInput,
  CreateSimulationBotInput,
  UpdateSimulationBotInput,
  CreateSimulationInput,
  CreateSimulationResearchInput,
  FloatRangeInput,
  IntRangeInput,
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
import { SimulationAutoRunnerService } from './simulation-auto-runner.service';
import { SimulationPlansService } from './simulation-plans.service';
import { buildSimulationParameterGrid } from './simulation-research.utils';

const DEFAULT_SELECTED_LEADER_COUNT = 10;
const DEFAULT_STANDARD_COLLATERAL_USD = 100;

@Injectable()
export class SimulationsService {
  private readonly logger = new Logger(SimulationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly simulationAutoRunnerService: SimulationAutoRunnerService,
    private readonly simulationPlansService: SimulationPlansService,
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

    if (input.minTrades <= 0) {
      throw new Error('minTrades must be greater than 0');
    }

    if (input.maxTrades < input.minTrades) {
      throw new Error('maxTrades must be greater than or equal to minTrades');
    }

    if (
      input.minR2 < 0 ||
      input.minR2 > 1 ||
      input.maxR2 < 0 ||
      input.maxR2 > 1
    ) {
      throw new Error('minR2 and maxR2 must be between 0 and 1');
    }

    if (input.maxR2 < input.minR2) {
      throw new Error('maxR2 must be greater than or equal to minR2');
    }

    if (input.maxSlope < input.minSlope) {
      throw new Error('maxSlope must be greater than or equal to minSlope');
    }
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

    if (
      input.maxTrades !== undefined &&
      input.maxTrades !== null &&
      input.minTrades !== undefined &&
      input.minTrades !== null &&
      input.maxTrades < input.minTrades
    ) {
      throw new Error('maxTrades must be greater than or equal to minTrades');
    }

    if (
      input.minR2 !== undefined &&
      input.minR2 !== null &&
      (input.minR2 < 0 || input.minR2 > 1)
    ) {
      throw new Error('minR2 must be between 0 and 1');
    }

    if (
      input.maxR2 !== undefined &&
      input.maxR2 !== null &&
      (input.maxR2 < 0 || input.maxR2 > 1)
    ) {
      throw new Error('maxR2 must be between 0 and 1');
    }

    if (
      input.minR2 !== undefined &&
      input.minR2 !== null &&
      input.maxR2 !== undefined &&
      input.maxR2 !== null &&
      input.maxR2 < input.minR2
    ) {
      throw new Error('maxR2 must be greater than or equal to minR2');
    }

    if (
      input.minSlope !== undefined &&
      input.minSlope !== null &&
      input.maxSlope !== undefined &&
      input.maxSlope !== null &&
      input.maxSlope < input.minSlope
    ) {
      throw new Error('maxSlope must be greater than or equal to minSlope');
    }

    if (
      input.minTrades !== undefined &&
      input.minTrades !== null &&
      input.minTrades <= 0
    ) {
      throw new Error('minTrades must be greater than 0');
    }
  }

  private validateRange(
    name: string,
    range: IntRangeInput | FloatRangeInput,
    options: {
      minAllowed?: number;
      maxAllowed?: number;
      integer?: boolean;
    } = {},
  ) {
    if (range.gap <= 0) {
      throw new Error(`${name} gap must be greater than 0`);
    }

    if (range.max < range.min) {
      throw new Error(`${name} max must be greater than or equal to min`);
    }

    if (options.integer) {
      if (
        !Number.isInteger(range.min) ||
        !Number.isInteger(range.max) ||
        !Number.isInteger(range.gap)
      ) {
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

    this.validateRange('minTrades', input.minTrades, {
      minAllowed: 1,
      integer: true,
    });
    this.validateRange('maxTrades', input.maxTrades, {
      minAllowed: 1,
      integer: true,
    });
    this.validateRange('minR2', input.minR2, { minAllowed: 0, maxAllowed: 1 });
    this.validateRange('maxR2', input.maxR2, { minAllowed: 0, maxAllowed: 1 });
    this.validateRange('minSlope', input.minSlope, { minAllowed: 0 });
    this.validateRange('maxSlope', input.maxSlope, { minAllowed: 0 });
    this.validateRange('maxLeverage', input.maxLeverage, { minAllowed: 0 });
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
      minTradesRange: {
        min: record.minTradesMin,
        max: record.minTradesMax,
        gap: record.minTradesGap,
      },
      maxTradesRange: {
        min: record.maxTradesMin,
        max: record.maxTradesMax,
        gap: record.maxTradesGap,
      },
      minR2Range: {
        min: record.minR2Min,
        max: record.minR2Max,
        gap: record.minR2Gap,
      },
      maxR2Range: {
        min: record.maxR2Min,
        max: record.maxR2Max,
        gap: record.maxR2Gap,
      },
      minSlopeRange: {
        min: record.minSlopeMin,
        max: record.minSlopeMax,
        gap: record.minSlopeGap,
      },
      maxSlopeRange: {
        min: record.maxSlopeMin,
        max: record.maxSlopeMax,
        gap: record.maxSlopeGap,
      },
      maxLeverageRange: {
        min: record.maxLeverageMin,
        max: record.maxLeverageMax,
        gap: record.maxLeverageGap,
      },
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

    const combinations = buildSimulationParameterGrid({
      direction: input.direction,
      minTrades: input.minTrades,
      maxTrades: input.maxTrades,
      minR2: input.minR2,
      maxR2: input.maxR2,
      minSlopeAbs: input.minSlope,
      maxSlopeAbs: input.maxSlope,
      maxLeverage: input.maxLeverage,
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
          minTradesMin: input.minTrades.min,
          minTradesMax: input.minTrades.max,
          minTradesGap: input.minTrades.gap,
          maxTradesMin: input.maxTrades.min,
          maxTradesMax: input.maxTrades.max,
          maxTradesGap: input.maxTrades.gap,
          minR2Min: input.minR2.min,
          minR2Max: input.minR2.max,
          minR2Gap: input.minR2.gap,
          maxR2Min: input.maxR2.min,
          maxR2Max: input.maxR2.max,
          maxR2Gap: input.maxR2.gap,
          minSlopeMin: input.minSlope.min,
          minSlopeMax: input.minSlope.max,
          minSlopeGap: input.minSlope.gap,
          maxSlopeMin: input.maxSlope.min,
          maxSlopeMax: input.maxSlope.max,
          maxSlopeGap: input.maxSlope.gap,
          maxLeverageMin: input.maxLeverage.min,
          maxLeverageMax: input.maxLeverage.max,
          maxLeverageGap: input.maxLeverage.gap,
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
          minTrades: combination.minTrades,
          maxTrades: combination.maxTrades,
          minR2: combination.minR2,
          maxR2: combination.maxR2,
          minSlope: combination.minSlope,
          maxSlope: combination.maxSlope,
          minNegativeR2: combination.minR2,
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
        startAt: dayjs(input.startAt).startOf('day').toDate(),
        endAt: dayjs(input.endAt).startOf('day').toDate(),
        minNegativeR2: input.minR2,
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
      minTrades: simulation.minTrades,
      maxTrades: simulation.maxTrades,
      minR2: simulation.minR2,
      maxR2: simulation.maxR2,
      minSlope: simulation.minSlope,
      maxSlope: simulation.maxSlope,
      minRatio: SIMULATION_SYSTEM_CONFIG.minRatio,
    });

    return simulation;
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

    return await this.prisma.simulation.update({
      where: { id: input.id },
      data: {
        title: input.title ?? undefined,
        description: input.description ?? undefined,
        selectedLeaderCount: input.selectedLeaderCount ?? undefined,
        direction: input.direction ?? undefined,
        minTrades: input.minTrades ?? undefined,
        maxTrades: input.maxTrades ?? undefined,
        minR2: input.minR2 ?? undefined,
        maxR2: input.maxR2 ?? undefined,
        minSlope: input.minSlope ?? undefined,
        maxSlope: input.maxSlope ?? undefined,
        minNegativeR2: input.minR2 ?? undefined,
        standardCollateralUsd: input.standardCollateralUsd ?? undefined,
        maxLeverage: input.maxLeverage ?? undefined,
      },
    });
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
      node: record,
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
    return await this.prisma.simulation.findUnique({
      where: { id },
    });
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
      simulations: record.simulations,
    };
  }

  async getSimulationsByResearch(researchId: number): Promise<Simulation[]> {
    return this.prisma.simulation.findMany({
      where: { researchId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
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

    return simulation;
  }

  async playAutoSimulation(id: number): Promise<Simulation> {
    return await this.simulationAutoRunnerService.playAutoSimulation(id);
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
