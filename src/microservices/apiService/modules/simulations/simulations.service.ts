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
  SimulationBotDetails,
  SimulationTradeHistory,
  Simulation,
  SimulationConnection,
  SimulationLeaderSelection,
} from './entities/simulations.entity';

import { PrismaService } from 'src/global/prisma.service';
import { EventLogsService } from '../trade-histories/event-logs.service';
import { getWeb3Info } from 'src/web3/utils';
import {
  BotMode,
  ContractStatus,
  Platform,
  SimulationStatus,
} from 'generated/prisma/enums';
import {
  PerpTradeHistory,
  PerpTradeHistoryOperation,
  PerpTradePosition,
} from '../trade-histories/entities/event-logs.entity';
import {
  calculateCosts,
  calculateLeaderScore,
  calculateMaxDrawdown,
  calculateProfitFactor,
  calculateTrend,
  cumulative,
  getPositionPnls,
  sum,
  suggestPositionSizing,
} from './simulation-automation.utils';
import { getReadableError } from 'src/utils';

type WindowRange = {
  startedAt: Date;
  endedAt: Date;
};

type ReverseSimulationResult = {
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

type CandidateEvaluation = {
  leaderAddress: string;
  score: number;
  suggestedRatio: number;
  suggestedCollateralUsd: number;
  rawTotalPnlUsd: number;
  rawSlope: number;
  rawR2: number;
  rawTradeCount: number;
  reverseNetPnlUsd: number;
  reverseDrawdownUsd: number;
  rejectedReason?: string;
};

type ContractContext = {
  id: number;
  chainId: number;
  version: any;
  platform: Platform;
};

type RangeEvaluationMap = Map<string, CandidateEvaluation[]>;
type LeaderPositionsCache = Map<string, Promise<PerpTradePosition[]>>;

type SimulationPlanDetailsOptions = {
  persistSummary?: boolean;
};

const CANDIDATE_PREFILTER_BATCH_SIZE = 50;
const CANDIDATE_RECENT_ACTIVITY_DAYS = 30;
const SIMULATION_SYSTEM_CONFIG = {
  minCollateralUsd: 10,
  maxCollateralUsd: 500,
  minRatio: 0,
  maxRatio: 3,
} as const;

@Injectable()
export class SimulationsService {
  private readonly logger = new Logger(SimulationsService.name);
  private readonly activeAutoSimulationRunIds = new Set<number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventLogsService: EventLogsService,
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

  private buildDailyRanges(startAt: Date, endAt: Date): WindowRange[] {
    const ranges: WindowRange[] = [];
    let cursor = dayjs(startAt).startOf('day');
    const end = dayjs(endAt).startOf('day');

    while (cursor.isBefore(end)) {
      const nextCursor = cursor.add(1, 'day');
      ranges.push({
        startedAt: cursor.toDate(),
        endedAt: nextCursor.isAfter(end) ? end.toDate() : nextCursor.toDate(),
      });
      cursor = nextCursor;
    }

    return ranges;
  }

  private getRangeKey(range: WindowRange) {
    return dayjs(range.startedAt).format('YYYY-MM-DD');
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
      (input.standardCollateralUsd < SIMULATION_SYSTEM_CONFIG.minCollateralUsd ||
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

    const totalSimulationPlans = this.buildDailyRanges(
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
        this.calculateSimulationPlanDetails(plan.id, {
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

    this.activeAutoSimulationRunIds.delete(id);

    return id;
  }

  async deleteSimulationPlan(id: number): Promise<number> {
    await this.prisma.$transaction(async (tx) => {
      const simulationPlan = await tx.simulationPlan.findUnique({
        where: { id },
        include: {
          simulation: true,
        },
      });

      if (!simulationPlan) {
        throw new Error('SimulationPlan not found');
      }

      const simulationId = simulationPlan.simulationId;

      if (simulationPlan.simulation?.status === SimulationStatus.Running) {
        throw new Error('Cannot delete a plan from a running simulation');
      }

      await tx.simulationLeaderSelection.deleteMany({
        where: { simulationPlanId: id },
      });

      await tx.simulationBot.deleteMany({
        where: { simulationPlanId: id },
      });

      await tx.simulationPlan.delete({
        where: { id },
      });

      if (simulationId) {
        const remainingPlans = await tx.simulationPlan.findMany({
          where: { simulationId },
          select: {
            cursor: true,
            endAt: true,
            totalLeaderPnl: true,
            totalFollowerPnl: true,
            totalPositions: true,
          },
        });

        const completedPlans = remainingPlans.filter(
          (plan) => plan.cursor.getTime() >= plan.endAt.getTime(),
        ).length;
        const totalLeaderPnl = sum(
          remainingPlans.map((plan) => plan.totalLeaderPnl),
        );
        const totalFollowerPnl = sum(
          remainingPlans.map((plan) => plan.totalFollowerPnl),
        );

        await tx.simulation.update({
          where: { id: simulationId },
          data: {
            totalSimulationPlans: remainingPlans.length,
            completedPlans,
            totalLeaderPnl,
            totalFollowerPnl,
            totalNetPnlUsd: totalFollowerPnl,
            tradeCount: sum(remainingPlans.map((plan) => plan.totalPositions)),
            progressPercent:
              remainingPlans.length > 0
                ? (completedPlans / remainingPlans.length) * 100
                : 0,
          },
        });
      }
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

    return simulation;
  }

  async playAutoSimulation(id: number): Promise<Simulation> {
    const simulation = await this.prisma.simulation.findUnique({
      where: { id },
    });

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

    const totalSimulationPlans = this.buildDailyRanges(
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

    setTimeout(() => {
      void this.runAutoSimulation(id);
    }, 0);

    return updatedSimulation;
  }

  private async runAutoSimulation(id: number) {
    if (!this.activeAutoSimulationRunIds.has(id)) {
      this.activeAutoSimulationRunIds.add(id);
    }

    try {
      const simulation = await this.prisma.simulation.findUnique({
        where: { id },
      });

      if (!simulation) {
        this.logWarn('Auto simulation run aborted: simulation not found', {
          simulationId: id,
        });
        return;
      }

      const allRanges = this.buildDailyRanges(
        simulation.startAt,
        simulation.endAt,
      );
      const startedAt = simulation.cursor ?? simulation.startAt;
      const ranges = allRanges.filter(
        (range) => range.endedAt.getTime() > startedAt.getTime(),
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
          const candidateLeaders = await this.findCandidateLeaders(
            simulation,
            warmupRange,
            checkedLeaderAddresses,
            false,
          );
          candidateLeaders.forEach((leaderAddress) =>
            checkedLeaderAddresses.add(leaderAddress),
          );

          const stats = await this.evaluateLeadersAcrossRanges(
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
        const current = await this.prisma.simulation.findUnique({
          where: { id },
        });

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

        const rangeKey = this.getRangeKey(range);
        const simulationPlan = planByRangeKey.get(rangeKey);

        if (!simulationPlan) {
          throw new Error(`Simulation plan not found for ${rangeKey}`);
        }

        const candidateLeaders = await this.findCandidateLeaders(
          current,
          range,
          checkedLeaderAddresses,
        );
        candidateLeaders.forEach((leaderAddress) =>
          checkedLeaderAddresses.add(leaderAddress),
        );

        const evaluationStats = await this.evaluateLeadersAcrossRanges(
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

      await this.aggregateSimulation(id);
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

    return simulationPlan;
  }

  private async createDailySimulationPlans(
    simulation: Simulation,
    ranges: WindowRange[],
  ) {
    const planByRangeKey = new Map<string, { id: number }>();

    for (const range of ranges) {
      planByRangeKey.set(
        this.getRangeKey(range),
        await this.createDailySimulationPlan(simulation, range),
      );
    }

    return planByRangeKey;
  }

  private async findCandidateLeaders(
    simulation: Simulation,
    range: WindowRange,
    checkedLeaderAddresses: Set<string> = new Set(),
    shouldLog = true,
  ) {
    const dateStr = dayjs(range.startedAt).format('YYYY-MM-DD');
    const records = await this.prisma.pnlSnapshotV2.findMany({
      where: {
        platform: simulation.platform,
        dateStr,
        accUSDPnl: {
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
    const uncheckedCandidateAddresses = candidateAddresses.filter(
      (address) => !checkedLeaderAddresses.has(address),
    );

    const recentActivityCutoff = dayjs(range.startedAt)
      .subtract(CANDIDATE_RECENT_ACTIVITY_DAYS, 'day')
      .toDate();
    const prefilteredAddresses: string[] = [];
    let noRecentTradeHistoryCount = 0;
    let lowRecentTradeHistoryCount = 0;

    for (
      let offset = 0;
      offset < uncheckedCandidateAddresses.length;
      offset += CANDIDATE_PREFILTER_BATCH_SIZE
    ) {
      const addressBatch = uncheckedCandidateAddresses.slice(
        offset,
        offset + CANDIDATE_PREFILTER_BATCH_SIZE,
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
        // Position reconstruction and closed-position minTrades checks happen
        // later in evaluateLeaderForReverseCopy.
        const recentTradeHistoryCount = eventCountByAddress.get(address) || 0;

        if (recentTradeHistoryCount === 0) {
          noRecentTradeHistoryCount += 1;
          return;
        }

        if (recentTradeHistoryCount < simulation.minTrades) {
          lowRecentTradeHistoryCount += 1;
          return;
        }

        prefilteredAddresses.push(address);
      });
    }

    if (shouldLog) {
      this.logDebug('Auto simulation candidates prefiltered', {
        simulationId: simulation.id,
        day: dateStr,
        snapshotCandidateCount: candidateAddresses.length,
        skippedAlreadyCheckedCount:
          candidateAddresses.length - uncheckedCandidateAddresses.length,
        prefilteredCount: prefilteredAddresses.length,
        noRecentTradeHistoryCount,
        lowRecentTradeHistoryCount,
      });
    }

    return prefilteredAddresses;
  }

  private async evaluateLeadersAcrossRanges(
    simulation: Simulation,
    leaderAddresses: string[],
    ranges: WindowRange[],
    contractById: Map<number, ContractContext>,
    leaderPositionsCache: LeaderPositionsCache,
    selectedCandidatesByRangeKey: RangeEvaluationMap,
  ) {
    let evaluatedCount = 0;
    let acceptedCount = 0;

    for (const leaderAddress of leaderAddresses) {
      const positions = await this.getCachedLeaderPositions(
        leaderAddress,
        simulation,
        contractById,
        leaderPositionsCache,
      );

      for (const range of ranges) {
        evaluatedCount += 1;

        const evaluation = this.evaluateLeaderForReverseCopyFromPositions(
          leaderAddress,
          positions,
          simulation,
          range,
        );

        if (evaluation.rejectedReason || evaluation.score <= 0) {
          continue;
        }

        acceptedCount += 1;

        const rangeKey = this.getRangeKey(range);
        const rangeEvaluations =
          selectedCandidatesByRangeKey.get(rangeKey) || [];

        rangeEvaluations.push(evaluation);
        selectedCandidatesByRangeKey.set(rangeKey, rangeEvaluations);
      }
    }

    return { evaluatedCount, acceptedCount };
  }

  private async getCachedLeaderPositions(
    leaderAddress: string,
    simulation: Simulation,
    contractById: Map<number, ContractContext>,
    leaderPositionsCache: LeaderPositionsCache,
  ) {
    const normalizedLeaderAddress = leaderAddress.toLowerCase();
    const existing = leaderPositionsCache.get(normalizedLeaderAddress);

    if (existing) {
      return existing;
    }

    const pendingPositions = this.loadLeaderPositionsForSimulation(
      normalizedLeaderAddress,
      simulation,
      contractById,
    );

    leaderPositionsCache.set(normalizedLeaderAddress, pendingPositions);

    return pendingPositions;
  }

  private async loadLeaderPositionsForSimulation(
    leaderAddress: string,
    simulation: Simulation,
    contractById: Map<number, ContractContext>,
  ) {
    const records = await this.prisma.perpTradingEventLog.findMany({
      where: {
        address: leaderAddress.toLowerCase(),
        platform: simulation.platform,
        date: {
          lt: simulation.endAt,
        },
      },
      orderBy: [{ date: 'asc' }, { block: 'asc' }, { id: 'asc' }],
    });

    const histories = this.eventLogsToHistories(records, contractById);

    return this.eventLogsService.convertToPerpTradePositionsWithSummary(
      simulation.platform,
      histories,
      {
        maxLeverage: simulation.maxLeverage,
      },
    ).positions;
  }

  private evaluateLeaderForReverseCopyFromPositions(
    leaderAddress: string,
    positions: PerpTradePosition[],
    simulation: Simulation,
    range: WindowRange,
  ): CandidateEvaluation {
    return this.evaluateLeaderPositionsForReverseCopy(
      leaderAddress,
      this.getClosedPositionsBefore(positions, range.startedAt),
      simulation,
    );
  }

  private evaluateLeaderPositionsForReverseCopy(
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
      reverseNetPnlUsd: 0,
      reverseDrawdownUsd: 0,
    };

    if (rawTradeCount < simulation.minTrades) {
      return { ...baseEvaluation, rejectedReason: 'LOW_TRADE_COUNT' };
    }

    if (rawTrend.slope >= 0) {
      return { ...baseEvaluation, rejectedReason: 'RAW_SLOPE_NOT_NEGATIVE' };
    }

    if (rawTrend.r2 < simulation.minNegativeR2) {
      return { ...baseEvaluation, rejectedReason: 'LOW_RAW_R2' };
    }

    if (rawAvgCollateralUsd < SIMULATION_SYSTEM_CONFIG.minCollateralUsd) {
      return { ...baseEvaluation, rejectedReason: 'LOW_AVG_COLLATERAL' };
    }

    const preliminaryReverse = this.simulateReverseCopyApproximation(
      closedPositions,
      1,
      simulation,
    );
    const preliminaryScore = this.scoreCandidate(
      simulation,
      rawTrend,
      rawTradeCount,
      preliminaryReverse,
    );
    const sizing = suggestPositionSizing({
      score: preliminaryScore,
      standardCollateralUsd: simulation.standardCollateralUsd,
      minCollateralUsd: SIMULATION_SYSTEM_CONFIG.minCollateralUsd,
      maxCollateralUsd: SIMULATION_SYSTEM_CONFIG.maxCollateralUsd,
      leaderAvgCollateralUsd: rawAvgCollateralUsd,
      minRatio: SIMULATION_SYSTEM_CONFIG.minRatio,
      maxRatio: SIMULATION_SYSTEM_CONFIG.maxRatio,
    });
    const reverse = this.simulateReverseCopyApproximation(
      closedPositions,
      sizing.suggestedRatio,
      simulation,
    );
    const score = this.scoreCandidate(
      simulation,
      rawTrend,
      rawTradeCount,
      reverse,
    );

    return {
      ...baseEvaluation,
      score,
      suggestedRatio: sizing.suggestedRatio,
      suggestedCollateralUsd: sizing.suggestedCollateralUsd,
      reverseNetPnlUsd: reverse.netPnlUsd,
      reverseDrawdownUsd: reverse.maxDrawdownUsd,
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
    reverse: ReverseSimulationResult,
  ) {
    return calculateLeaderScore({
      rawSlope: rawTrend.slope,
      rawR2: rawTrend.r2,
      rawTradeCount,
      reverseNetPnlUsd: reverse.netPnlUsd,
      reverseSlope: reverse.slope,
      reverseR2: reverse.r2,
      reverseMaxDrawdownUsd: reverse.maxDrawdownUsd,
      reverseProfitFactor: reverse.profitFactor,
      totalCostUsd: reverse.totalCostUsd,
      grossProfitUsd: reverse.grossProfitUsd,
      topTradeProfitUsd: reverse.topTradeProfitUsd,
      minTrades: simulation.minTrades,
      maxReverseDrawdownUsd: SIMULATION_SYSTEM_CONFIG.maxCollateralUsd,
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

  private calculatePositionCost(
    position: PerpTradePosition,
    ratio: number,
    simulation: Simulation,
  ) {
    const costs = calculateCosts({
      positions: [position],
      ratio,
      openFeeRate: 0,
      closeFeeRate: 0,
      slippageRate: 0,
    });

    return costs.totalCostUsd;
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

  private simulateReverseCopyApproximation(
    positions: PerpTradePosition[],
    ratio: number,
    simulation: Simulation,
  ): ReverseSimulationResult {
    const grossPositionPnls = positions.map((position) => {
      const reverseBasePnl =
        -sum(position.histories.map((history) => history.usdBasePnl)) * ratio;
      const maxLoss =
        -Math.abs(this.calculatePositionMaxDepositedUsd(position)) * ratio;

      return Math.max(maxLoss, reverseBasePnl);
    });
    const costs = calculateCosts({
      positions,
      ratio,
      openFeeRate: 0,
      closeFeeRate: 0,
      slippageRate: 0,
    });
    const netPositionPnls = grossPositionPnls.map(
      (positionPnl, index) =>
        positionPnl -
        this.calculatePositionCost(positions[index], ratio, simulation),
    );
    const equityCurve = cumulative(netPositionPnls);
    const trend = calculateTrend(equityCurve);
    const grossProfitUsd = sum(grossPositionPnls.filter((item) => item > 0));

    return {
      grossPnlUsd: sum(grossPositionPnls),
      netPnlUsd: sum(netPositionPnls),
      totalCostUsd: costs.totalCostUsd,
      maxDrawdownUsd: calculateMaxDrawdown(equityCurve),
      slope: trend.slope,
      r2: trend.r2,
      profitFactor: calculateProfitFactor(netPositionPnls),
      grossProfitUsd,
      topTradeProfitUsd: Math.max(0, ...grossPositionPnls),
    };
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
        mode: BotMode.Reversed,
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

    this.logDebug('Auto simulation day created bots', {
      simulationId: simulation.id,
      simulationPlanId,
      selectedCount: selectedCandidates.length,
      botCount: botInputs.length,
    });
  }

  private async aggregateSimulation(id: number) {
    const plans = await this.prisma.simulationPlan.findMany({
      where: { simulationId: id },
      orderBy: [{ startAt: 'asc' }, { id: 'asc' }],
    });

    const followerPositionPnls: number[] = [];
    let totalLeaderPnl = 0;

    for (const plan of plans) {
      const details = await this.calculateSimulationPlanDetails(plan.id, {
        persistSummary: true,
      });
      totalLeaderPnl += details.totalLeaderPnl;

      details.simulationBots.forEach((bot) => {
        bot.positions.forEach((position) => {
          followerPositionPnls.push(position.followerPnl);
        });
      });
    }

    const totalFollowerPnl = sum(followerPositionPnls);
    const tradeCount = followerPositionPnls.length;
    const positiveTrades = followerPositionPnls.filter(
      (item) => item > 0,
    ).length;

    await this.prisma.simulation.update({
      where: { id },
      data: {
        status: SimulationStatus.Completed,
        progressPhase: 'completed',
        progressMessage: 'Auto simulation completed',
        progressPercent: 100,
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

  async createSimulationPlan(
    createSimulationPlanInput: CreateSimulationPlanInput,
  ): Promise<SimulationPlan> {
    const simulationPlan = await this.prisma.simulationPlan.create({
      data: {
        ...createSimulationPlanInput,
        startAt: new Date(
          dayjs(createSimulationPlanInput.startAt).format('YYYY-MM-DD'),
        ),
        endAt: new Date(
          dayjs(createSimulationPlanInput.endAt).format('YYYY-MM-DD'),
        ),
        cursor: createSimulationPlanInput.startAt,
      },
      include: {
        simulationBots: {
          include: {
            leaderContract: true,
          },
        },
      },
    });

    return simulationPlan;
  }

  async batchCreateSimulationBots(
    inputs: CreateSimulationBotInput[],
  ): Promise<SimulationBot[]> {
    if (inputs.length === 0) {
      return [];
    }

    const simulationPlan = await this.prisma.simulationPlan.findUnique({
      where: {
        id: inputs[0].simulationPlanId,
      },
    });

    if (!simulationPlan) {
      throw new Error('Invalid plan id');
    }

    const simulationBots: SimulationBot[] = [];

    for (let i = 0; i < inputs.length; i++) {
      const input = inputs[i];

      const bot = await this.prisma.simulationBot.create({
        data: {
          ...input,
          startedAt: simulationPlan.cursor,
        },
        include: {
          leaderContract: true,
        },
      });

      simulationBots.push(bot);
    }

    return simulationBots;
  }

  async updateSimulationBot(
    input: UpdateSimulationBotInput,
  ): Promise<SimulationBot> {
    return await this.prisma.simulationBot.update({
      where: {
        id: input.id,
      },
      data: {
        ratio: input.ratio ?? undefined,
        maxLeverage: input.maxLeverage ?? undefined,
        mode: input.mode ?? undefined,
      },
      include: {
        leaderContract: true,
      },
    });
  }

  async playSimulationPlan(id: number): Promise<SimulationPlan> {
    const simulationPlan = await this.prisma.simulationPlan.findUnique({
      where: {
        id,
      },
    });

    if (!simulationPlan) {
      throw new Error('Invalid plan id');
    }

    const nextCursor = Math.min(
      simulationPlan.endAt.getTime(),
      dayjs(simulationPlan.cursor).add(1, 'day').toDate().getTime(),
    );

    return await this.prisma.simulationPlan.update({
      where: {
        id,
      },
      data: {
        cursor: new Date(nextCursor),
      },
      include: {
        simulationBots: {
          include: {
            leaderContract: true,
          },
        },
      },
    });
  }

  async stopSimulationBot(id: number): Promise<SimulationBot> {
    const simulationBot = await this.prisma.simulationBot.findUnique({
      where: {
        id,
      },
      include: {
        simulationPlan: true,
      },
    });

    if (!simulationBot) {
      throw new Error('Invalid bot id');
    }

    return await this.prisma.simulationBot.update({
      where: {
        id,
      },
      data: {
        stoppedAt: simulationBot.simulationPlan.cursor,
      },
      include: {
        leaderContract: true,
      },
    });
  }

  async getSimulationPlans(
    first: number,
    after: number | null,
  ): Promise<SimulationPlanConnection> {
    const records = await this.prisma.simulationPlan.findMany({
      where: {
        simulationId: null,
      },
      skip: after ? 1 : undefined,
      take: first,
      cursor: after
        ? {
            id: after,
          }
        : undefined,
      orderBy: [
        {
          id: 'desc',
        },
      ],
      include: {
        simulationBots: {
          include: {
            leaderContract: true,
          },
        },
      },
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

  async calculateSimulationPlanDetails(
    id: number,
    options: SimulationPlanDetailsOptions = {},
  ): Promise<SimulationPlanDetails> {
    const { persistSummary = true } = options;
    const simulationPlan = await this.prisma.simulationPlan.findUnique({
      where: { id },
      include: {
        simulationBots: {
          include: {
            leaderContract: true,
          },
        },
      },
    });

    if (!simulationPlan) {
      throw new Error('SimulationPlan not found');
    }

    const simulationBotDetails: SimulationBotDetails[] = [];

    let totalPositions = 0;
    let openedPositions = 0;
    let totalLeaderPnl = 0;
    let totalFollowerPnl = 0;

    for (const bot of simulationPlan.simulationBots) {
      const stoppedAt = bot.stoppedAt;
      const records = await this.prisma.perpTradingEventLog.findMany({
        where: {
          address: bot.leaderAddress.toLowerCase(),
          contractId: bot.leaderContractId,
          date: {
            gte: bot.startedAt,
            ...(stoppedAt
              ? { lt: dayjs(stoppedAt).add(60, 'day').toDate() }
              : {}),
          },
        },
        orderBy: [
          {
            date: 'asc',
          },
          {
            block: 'asc',
          },
          {
            id: 'asc',
          },
        ],
      });

      const positionsWithSummary =
        this.eventLogsService.convertToPerpTradePositionsWithSummary(
          bot.leaderContract.platform,
          records
            .map((record) => {
              const history = getWeb3Info(
                bot.leaderContract.platform,
                bot.leaderContract.version,
              ).eventToPerpTradeHistory(
                bot.leaderContract.chainId,
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
            .filter((item) => !!item),
          {
            stoppedAt: stoppedAt || undefined,
            maxLeverage: bot.maxLeverage,
          },
        );

      const signer = bot.mode === BotMode.Reversed ? -1 : 1;

      const simulationPositions = positionsWithSummary.positions.map(
        ({ histories }) => {
          let leaderPnl = 0;
          let followerPnl = 0;

          const simulationHistories: SimulationTradeHistory[] = [];

          for (const history of histories) {
            const followerUsdFee =
              history.usdFee !== 0
                ? Math.min(-0.5, history.usdFee * bot.ratio)
                : 0;
            const followerUsdBasePnl = history.usdBasePnl * signer * bot.ratio;
            const followerUsdPnl = Math.max(
              -history.collateralDeltaUsd * bot.ratio,
              followerUsdBasePnl + followerUsdFee,
            );

            const follower = {
              ...history,
              id: -history.id,
              usdPnl: followerUsdPnl,
              usdBasePnl: followerUsdBasePnl,
              usdFee: followerUsdFee,
              sizeInUsd: history.sizeInUsd * bot.ratio,
              collateralInUsd: history.collateralInUsd * bot.ratio,
              collateralDeltaUsd: history.collateralDeltaUsd * bot.ratio,
              sizeDeltaUsd: history.sizeDeltaUsd * bot.ratio,
              isLong:
                bot.mode === BotMode.Reversed
                  ? !history.isLong
                  : history.isLong,
            };

            leaderPnl += history.usdPnl;
            followerPnl += follower.usdPnl;

            simulationHistories.push({
              leader: history,
              follower,
            });
          }

          return {
            histories: simulationHistories,
            leaderPnl,
            followerPnl,
          };
        },
      );

      totalPositions += positionsWithSummary.totalPositions;
      openedPositions += positionsWithSummary.openedPositions;
      totalLeaderPnl += positionsWithSummary.totalPnl;
      totalFollowerPnl += simulationPositions
        .map((position) => position.followerPnl)
        .reduce((acc, item) => acc + item, 0);

      const calculatedBot = {
        ...bot,
        openedPositions: positionsWithSummary.openedPositions,
        totalPositions: positionsWithSummary.totalPositions,
        totalPnl: positionsWithSummary.totalPnl,
        maxDuration: positionsWithSummary.maxDuration,
        avgDuration: positionsWithSummary.avgDuration,
        avgPnl: positionsWithSummary.avgPnl,
        avgPositivePnl: positionsWithSummary.avgPositivePnl,
        avgNegativePnl: positionsWithSummary.avgNegativePnl,
        avgSize: positionsWithSummary.avgSize,
        avgCollateral: positionsWithSummary.avgCollateral,
        avgPnlPercentageBySize: positionsWithSummary.avgPnlPercentageBySize,
        avgPnlPercentageByCollateral:
          positionsWithSummary.avgPnlPercentageByCollateral,
        avgLeverage: positionsWithSummary.avgLeverage,
      };

      const simulationBot = persistSummary
        ? await this.prisma.simulationBot.update({
            where: {
              id: bot.id,
            },
            data: {
              openedPositions: calculatedBot.openedPositions,
              totalPositions: calculatedBot.totalPositions,
              totalPnl: calculatedBot.totalPnl,
              maxDuration: calculatedBot.maxDuration,
              avgDuration: calculatedBot.avgDuration,
              avgPnl: calculatedBot.avgPnl,
              avgPositivePnl: calculatedBot.avgPositivePnl,
              avgNegativePnl: calculatedBot.avgNegativePnl,
              avgSize: calculatedBot.avgSize,
              avgCollateral: calculatedBot.avgCollateral,
              avgPnlPercentageBySize: calculatedBot.avgPnlPercentageBySize,
              avgPnlPercentageByCollateral:
                calculatedBot.avgPnlPercentageByCollateral,
              avgLeverage: calculatedBot.avgLeverage,
            },
            include: {
              leaderContract: true,
            },
          })
        : calculatedBot;

      simulationBotDetails.push({
        ...simulationBot,
        positions: simulationPositions,
      });
    }

    const calculatedSimulationPlan = {
      ...simulationPlan,
      openedPositions,
      totalPositions,
      totalLeaderPnl,
      totalFollowerPnl,
    };

    const updatedSimulationPlan = persistSummary
      ? await this.prisma.simulationPlan.update({
          where: {
            id,
          },
          data: {
            openedPositions,
            totalPositions,
            totalLeaderPnl,
            totalFollowerPnl,
          },
        })
      : calculatedSimulationPlan;

    return {
      ...updatedSimulationPlan,
      simulationBots: simulationBotDetails,
    };
  }

  async getSimulationPlanById(id: number): Promise<SimulationPlanDetails> {
    return await this.calculateSimulationPlanDetails(id);
  }
}
