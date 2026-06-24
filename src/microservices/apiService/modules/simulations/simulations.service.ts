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
import { BotMode, Platform, SimulationStatus } from 'generated/prisma/enums';
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

const CANDIDATE_PREFILTER_BATCH_SIZE = 50;
const CANDIDATE_RECENT_ACTIVITY_DAYS = 30;

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

  private validateSimulationInput(input: CreateSimulationInput) {
    if (new Date(input.startAt).getTime() >= new Date(input.endAt).getTime()) {
      throw new Error('Simulation startAt must be before endAt');
    }

    if (
      input.minCollateralUsd > input.standardCollateralUsd ||
      input.standardCollateralUsd > input.maxCollateralUsd
    ) {
      throw new Error(
        'standardCollateralUsd must be between minCollateralUsd and maxCollateralUsd',
      );
    }

    if (input.minRatio > input.maxRatio) {
      throw new Error('minRatio must be lower than maxRatio');
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

    if (input.minRatio < 0) {
      throw new Error('minRatio cannot be negative');
    }
  }

  private validateSimulationUpdate(input: UpdateSimulationInput) {
    if (
      input.minCollateralUsd !== undefined &&
      input.minCollateralUsd !== null &&
      input.maxCollateralUsd !== undefined &&
      input.maxCollateralUsd !== null &&
      input.minCollateralUsd > input.maxCollateralUsd
    ) {
      throw new Error('minCollateralUsd must be lower than maxCollateralUsd');
    }

    if (
      input.minRatio !== undefined &&
      input.minRatio !== null &&
      input.maxRatio !== undefined &&
      input.maxRatio !== null &&
      input.minRatio > input.maxRatio
    ) {
      throw new Error('minRatio must be lower than maxRatio');
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

    if (
      input.minRatio !== undefined &&
      input.minRatio !== null &&
      input.minRatio < 0
    ) {
      throw new Error('minRatio cannot be negative');
    }
  }

  async createSimulation(input: CreateSimulationInput): Promise<Simulation> {
    this.validateSimulationInput(input);

    const totalSimulationPlans = this.buildDailyRanges(
      input.startAt,
      input.endAt,
    ).length;

    this.logDebug('Creating auto simulation', {
      title: input.title,
      platform: input.platform,
      startAt: input.startAt,
      endAt: input.endAt,
      totalSimulationPlans,
      selectedLeaderCount: input.selectedLeaderCount,
      minTrades: input.minTrades,
      minNegativeR2: input.minNegativeR2,
      minRatio: input.minRatio,
      maxRatio: input.maxRatio,
      maxLeverage: input.maxLeverage,
    });

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

    this.logDebug('Created auto simulation', {
      simulationId: simulation.id,
      startAt: simulation.startAt,
      endAt: simulation.endAt,
      totalSimulationPlans: simulation.totalSimulationPlans,
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
        minCollateralUsd: input.minCollateralUsd ?? undefined,
        maxCollateralUsd: input.maxCollateralUsd ?? undefined,
        minRatio: input.minRatio ?? undefined,
        maxRatio: input.maxRatio ?? undefined,
        maxLeverage: input.maxLeverage ?? undefined,
        openFeeRate: input.openFeeRate ?? undefined,
        closeFeeRate: input.closeFeeRate ?? undefined,
        slippageRate: input.slippageRate ?? undefined,
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
    const simulation = await this.prisma.simulation.findUnique({
      where: { id },
    });

    if (!simulation) {
      throw new Error('Simulation not found');
    }

    if (simulation.status === SimulationStatus.Running) {
      throw new Error('Cannot delete a running simulation');
    }

    await this.prisma.simulation.delete({
      where: { id },
    });

    return id;
  }

  async cancelSimulation(id: number): Promise<Simulation> {
    this.logWarn('Cancelling auto simulation', { simulationId: id });

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
    this.logDebug('Play auto simulation requested', { simulationId: id });

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

    this.logDebug('Accepting auto simulation run', {
      simulationId: id,
      status: simulation.status,
      cursor: simulation.cursor,
      startAt: simulation.startAt,
      endAt: simulation.endAt,
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
      this.logDebug('Scheduling auto simulation background run', {
        simulationId: id,
      });
      void this.runAutoSimulation(id);
    }, 0);

    return updatedSimulation;
  }

  private async runAutoSimulation(id: number) {
    if (this.activeAutoSimulationRunIds.has(id)) {
      this.logDebug('Auto simulation worker confirmed active run', {
        simulationId: id,
      });
    } else {
      this.activeAutoSimulationRunIds.add(id);
      this.logWarn(
        'Auto simulation worker started without pre-registered run',
        {
          simulationId: id,
        },
      );
    }

    this.logDebug('Auto simulation background run started', {
      simulationId: id,
    });

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

      this.logDebug('Auto simulation ranges resolved', {
        simulationId: id,
        startAt: simulation.startAt,
        endAt: simulation.endAt,
        cursor: simulation.cursor,
        resumedFrom: startedAt,
        allRangeCount: allRanges.length,
        remainingRangeCount: ranges.length,
        firstRemainingStartAt: ranges[0]?.startedAt,
        firstRemainingEndAt: ranges[0]?.endedAt,
      });

      const platformContracts = await this.prisma.contract.findMany({
        where: { platform: simulation.platform },
        orderBy: [{ chainId: 'asc' }, { id: 'asc' }],
      });

      this.logDebug('Auto simulation platform contracts loaded', {
        simulationId: id,
        platform: simulation.platform,
        contractCount: platformContracts.length,
        contractIds: platformContracts.map((contract) => contract.id),
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

        this.logDebug('Auto simulation daily range started', {
          simulationId: id,
          rangeStartAt: range.startedAt,
          rangeEndAt: range.endedAt,
          currentCursor: current.cursor,
          completedPlans: current.completedPlans,
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

        const simulationPlan = await this.createDailySimulationPlan(
          current,
          range,
        );
        const selectedCandidates = await this.selectLeadersForRange(
          current,
          range,
          contractById,
        );

        this.logDebug('Auto simulation daily leaders selected', {
          simulationId: id,
          simulationPlanId: simulationPlan.id,
          rangeStartAt: range.startedAt,
          selectedCount: selectedCandidates.length,
          topCandidates: selectedCandidates.slice(0, 5).map((candidate) => ({
            leaderAddress: candidate.leaderAddress,
            score: candidate.score,
            suggestedRatio: candidate.suggestedRatio,
            rawTradeCount: candidate.rawTradeCount,
            rawTotalPnlUsd: candidate.rawTotalPnlUsd,
            reverseNetPnlUsd: candidate.reverseNetPnlUsd,
          })),
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

        this.logDebug('Auto simulation calculating daily plan details', {
          simulationId: id,
          simulationPlanId: simulationPlan.id,
        });

        await this.calculateSimulationPlanDetails(simulationPlan.id);

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

        this.logDebug('Auto simulation daily range completed', {
          simulationId: id,
          simulationPlanId: simulationPlan.id,
          rangeStartAt: range.startedAt,
          rangeEndAt: range.endedAt,
          completedPlans,
          totalPlans: allRanges.length,
        });
      }

      this.logDebug('Auto simulation aggregating final results', {
        simulationId: id,
      });

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
      this.logDebug('Auto simulation worker released active run', {
        simulationId: id,
      });
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
      this.logWarn('Reusing existing daily simulation plan', {
        simulationId: simulation.id,
        simulationPlanId: existingSimulationPlan.id,
        startAt: existingSimulationPlan.startAt,
        endAt: existingSimulationPlan.endAt,
        cursor: existingSimulationPlan.cursor,
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
        cursor: range.startedAt,
        simulationId: simulation.id,
      },
    });

    this.logDebug('Created daily simulation plan', {
      simulationId: simulation.id,
      simulationPlanId: simulationPlan.id,
      startAt: simulationPlan.startAt,
      endAt: simulationPlan.endAt,
      cursor: simulationPlan.cursor,
    });

    return simulationPlan;
  }

  private async findCandidateLeaders(
    simulation: Simulation,
    range: WindowRange,
  ) {
    const dateStr = dayjs(range.startedAt).format('YYYY-MM-DD');
    this.logDebug('Finding auto simulation candidate leaders', {
      simulationId: simulation.id,
      platform: simulation.platform,
      dateStr,
      minTrades: simulation.minTrades,
      recentActivityDays: CANDIDATE_RECENT_ACTIVITY_DAYS,
    });

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

    this.logDebug('Auto simulation candidate snapshot records loaded', {
      simulationId: simulation.id,
      dateStr,
      snapshotRecordCount: records.length,
      uniqueCandidateCount: new Set(candidateAddresses).size,
    });

    const recentActivityCutoff = dayjs(range.startedAt)
      .subtract(CANDIDATE_RECENT_ACTIVITY_DAYS, 'day')
      .toDate();
    const prefilteredAddresses: string[] = [];
    let noRecentTradeHistoryCount = 0;
    let lowRecentTradeHistoryCount = 0;

    for (
      let offset = 0;
      offset < candidateAddresses.length;
      offset += CANDIDATE_PREFILTER_BATCH_SIZE
    ) {
      const addressBatch = candidateAddresses.slice(
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

    this.logDebug('Auto simulation candidate prefilter completed', {
      simulationId: simulation.id,
      dateStr,
      snapshotCandidateCount: candidateAddresses.length,
      prefilteredCount: prefilteredAddresses.length,
      noRecentTradeHistoryCount,
      lowRecentTradeHistoryCount,
      minRecentTradeHistoryCount: simulation.minTrades,
    });

    return prefilteredAddresses;
  }

  private async selectLeadersForRange(
    simulation: Simulation,
    range: WindowRange,
    contractById: Map<number, ContractContext>,
  ) {
    const candidateLeaders = await this.findCandidateLeaders(simulation, range);
    const evaluated: CandidateEvaluation[] = [];

    this.logDebug('Evaluating auto simulation candidate leaders', {
      simulationId: simulation.id,
      rangeStartAt: range.startedAt,
      candidateCount: candidateLeaders.length,
    });

    for (const leaderAddress of candidateLeaders) {
      evaluated.push(
        await this.evaluateLeaderForReverseCopy(
          leaderAddress,
          simulation,
          range,
          contractById,
        ),
      );
    }

    const rejectedByReason = evaluated.reduce<Record<string, number>>(
      (acc, item) => {
        const reason = item.rejectedReason || 'ACCEPTED';
        acc[reason] = (acc[reason] || 0) + 1;
        return acc;
      },
      {},
    );
    const selected = evaluated
      .filter((item) => !item.rejectedReason && item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, simulation.selectedLeaderCount);

    this.logDebug('Auto simulation candidate evaluation completed', {
      simulationId: simulation.id,
      rangeStartAt: range.startedAt,
      evaluatedCount: evaluated.length,
      selectedCount: selected.length,
      rejectedByReason,
      selectedLeaderCountLimit: simulation.selectedLeaderCount,
    });

    return selected;
  }

  private async evaluateLeaderForReverseCopy(
    leaderAddress: string,
    simulation: Simulation,
    range: WindowRange,
    contractById: Map<number, ContractContext>,
  ): Promise<CandidateEvaluation> {
    const positions = await this.loadLeaderPositions(
      leaderAddress,
      simulation.platform,
      range,
      contractById,
      simulation.maxLeverage,
    );
    const closedPositions = positions.filter((position) =>
      this.isClosedPosition(position),
    );
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

    if (rawAvgCollateralUsd < simulation.minCollateralUsd) {
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
      minCollateralUsd: simulation.minCollateralUsd,
      maxCollateralUsd: simulation.maxCollateralUsd,
      leaderAvgCollateralUsd: rawAvgCollateralUsd,
      minRatio: simulation.minRatio,
      maxRatio: simulation.maxRatio,
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
      maxReverseDrawdownUsd: simulation.maxCollateralUsd,
    });
  }

  private async loadLeaderPositions(
    leaderAddress: string,
    platform: Platform,
    range: WindowRange,
    contractById: Map<number, ContractContext>,
    maxLeverage: number,
  ) {
    const records = await this.prisma.perpTradingEventLog.findMany({
      where: {
        address: leaderAddress.toLowerCase(),
        platform,
        date: {
          lt: range.startedAt,
        },
      },
      orderBy: [{ date: 'asc' }, { block: 'asc' }, { id: 'asc' }],
    });

    const histories = this.eventLogsToHistories(records, contractById);

    return this.eventLogsService.convertToPerpTradePositionsWithSummary(
      platform,
      histories,
      {
        maxLeverage,
      },
    ).positions;
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
      openFeeRate: simulation.openFeeRate,
      closeFeeRate: simulation.closeFeeRate,
      slippageRate: simulation.slippageRate,
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
      openFeeRate: simulation.openFeeRate,
      closeFeeRate: simulation.closeFeeRate,
      slippageRate: simulation.slippageRate,
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
      this.logWarn(
        'No leader selections to persist for daily simulation plan',
        {
          simulationId,
          simulationPlanId,
          date,
        },
      );
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

    this.logDebug('Persisted auto simulation leader selections', {
      simulationId,
      simulationPlanId,
      date,
      selectedCount: selectedCandidates.length,
    });
  }

  private async createSimulationBotsForSelections(
    simulationPlanId: number,
    startedAt: Date,
    stoppedAt: Date,
    simulation: Simulation,
    selectedCandidates: CandidateEvaluation[],
    contracts: { id: number }[],
  ) {
    if (selectedCandidates.length === 0 || contracts.length === 0) {
      this.logWarn('Skipping auto simulation bot creation', {
        simulationId: simulation.id,
        simulationPlanId,
        selectedCount: selectedCandidates.length,
        contractCount: contracts.length,
      });
      return;
    }

    const existingBotCount = await this.prisma.simulationBot.count({
      where: { simulationPlanId },
    });

    if (existingBotCount > 0) {
      this.logWarn('Skipping auto simulation bot creation for existing plan', {
        simulationId: simulation.id,
        simulationPlanId,
        existingBotCount,
        selectedCount: selectedCandidates.length,
        contractCount: contracts.length,
      });
      return;
    }

    const botCount = selectedCandidates.length * contracts.length;

    await this.prisma.simulationBot.createMany({
      data: selectedCandidates.flatMap((candidate) =>
        contracts.map((contract) => ({
          leaderAddress: candidate.leaderAddress,
          leaderContractId: contract.id,
          simulationPlanId,
          startedAt,
          stoppedAt,
          mode: BotMode.Reversed,
          ratio: candidate.suggestedRatio,
          maxLeverage: simulation.maxLeverage,
        })),
      ),
    });

    this.logDebug('Created auto simulation bots for daily plan', {
      simulationId: simulation.id,
      simulationPlanId,
      selectedCount: selectedCandidates.length,
      contractCount: contracts.length,
      botCount,
      startedAt,
      stoppedAt,
    });
  }

  private async aggregateSimulation(id: number) {
    this.logDebug('Aggregating auto simulation', { simulationId: id });

    const plans = await this.prisma.simulationPlan.findMany({
      where: { simulationId: id },
      orderBy: [{ startAt: 'asc' }, { id: 'asc' }],
    });

    this.logDebug('Auto simulation plans loaded for aggregation', {
      simulationId: id,
      planCount: plans.length,
      planIds: plans.map((plan) => plan.id),
    });

    const followerPositionPnls: number[] = [];
    let totalLeaderPnl = 0;

    for (const plan of plans) {
      const details = await this.calculateSimulationPlanDetails(plan.id);
      totalLeaderPnl += details.totalLeaderPnl;

      this.logDebug('Aggregated daily simulation plan details', {
        simulationId: id,
        simulationPlanId: plan.id,
        botCount: details.simulationBots.length,
        totalLeaderPnl: details.totalLeaderPnl,
        totalFollowerPnl: details.totalFollowerPnl,
        totalPositions: details.totalPositions,
      });

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

    this.logDebug('Auto simulation aggregate totals calculated', {
      simulationId: id,
      totalLeaderPnl,
      totalFollowerPnl,
      tradeCount,
      positiveTrades,
      winRate: tradeCount > 0 ? positiveTrades / tradeCount : 0,
      profitFactor: calculateProfitFactor(followerPositionPnls),
      maxDrawdownUsd: calculateMaxDrawdown(cumulative(followerPositionPnls)),
    });

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
  ): Promise<SimulationPlanDetails> {
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
      const records = await this.prisma.perpTradingEventLog.findMany({
        where: {
          address: bot.leaderAddress.toLowerCase(),
          contractId: bot.leaderContractId,
          date: {
            gte: bot.startedAt,
            lte: simulationPlan.cursor,
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
            stoppedAt: bot.stoppedAt || undefined,
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

      const updatedSimuationBot = await this.prisma.simulationBot.update({
        where: {
          id: bot.id,
        },
        data: {
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
        },
        include: {
          leaderContract: true,
        },
      });

      simulationBotDetails.push({
        ...updatedSimuationBot,
        positions: simulationPositions,
      });
    }

    const updatedSimulationPlan = await this.prisma.simulationPlan.update({
      where: {
        id,
      },
      data: {
        openedPositions,
        totalPositions,
        totalLeaderPnl,
        totalFollowerPnl,
      },
    });

    return {
      ...updatedSimulationPlan,
      simulationBots: simulationBotDetails,
    };
  }

  async getSimulationPlanById(id: number): Promise<SimulationPlanDetails> {
    return await this.calculateSimulationPlanDetails(id);
  }
}
