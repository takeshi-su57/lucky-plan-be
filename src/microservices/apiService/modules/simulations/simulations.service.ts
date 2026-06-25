import { Injectable, Logger } from '@nestjs/common';
import dayjs from 'dayjs';

import {
  CreateSimulationPlanInput,
  CreateSimulationBotInput,
  UpdateSimulationBotInput,
  CreateSimulationInput,
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
} from './entities/simulations.entity';

import { PrismaService } from 'src/global/prisma.service';
import { SimulationStatus } from 'generated/prisma/enums';
import { SIMULATION_SYSTEM_CONFIG } from './simulation.constants';
import { buildDailyRanges } from './simulation-range.utils';
import { SimulationAutoRunnerService } from './simulation-auto-runner.service';
import { SimulationPlansService } from './simulation-plans.service';

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

    if (input.minNegativeR2 < 0 || input.minNegativeR2 > 1) {
      throw new Error('minNegativeR2 must be between 0 and 1');
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
      input.minTrades !== undefined &&
      input.minTrades !== null &&
      input.minTrades <= 0
    ) {
      throw new Error('minTrades must be greater than 0');
    }

    if (
      input.minNegativeR2 !== undefined &&
      input.minNegativeR2 !== null &&
      (input.minNegativeR2 < 0 || input.minNegativeR2 > 1)
    ) {
      throw new Error('minNegativeR2 must be between 0 and 1');
    }
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
      minTrades: simulation.minTrades,
      minNegativeR2: simulation.minNegativeR2,
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
        minTrades: input.minTrades ?? undefined,
        minNegativeR2: input.minNegativeR2 ?? undefined,
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
    const plans = await this.prisma.simulationPlan.findMany({
      where: { simulationId },
      orderBy: [{ startAt: 'asc' }, { id: 'asc' }],
      select: { id: true, cursor: true },
    });

    return await Promise.all(
      plans.map((plan) =>
        this.simulationPlansService.calculateSimulationPlanDetails(plan.id, {
          persistSummary: false,
        }),
      ),
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
