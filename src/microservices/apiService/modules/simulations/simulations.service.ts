import { Injectable } from '@nestjs/common';
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventLogsService: EventLogsService,
  ) {}

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
  }

  async createSimulation(input: CreateSimulationInput): Promise<Simulation> {
    this.validateSimulationInput(input);

    const totalSimulationPlans = this.buildDailyRanges(
      input.startAt,
      input.endAt,
    ).length;

    return await this.prisma.simulation.create({
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
    return await this.prisma.simulation.update({
      where: { id },
      data: {
        status: SimulationStatus.Cancelled,
        progressPhase: 'cancelled',
        progressMessage: 'Simulation cancellation requested',
      },
    });
  }

  async playAutoSimulation(id: number): Promise<Simulation> {
    const simulation = await this.prisma.simulation.findUnique({
      where: { id },
    });

    if (!simulation) {
      throw new Error('Simulation not found');
    }

    if (simulation.status === SimulationStatus.Running) {
      throw new Error('Simulation is already running');
    }

    const totalSimulationPlans = this.buildDailyRanges(
      simulation.startAt,
      simulation.endAt,
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

    setTimeout(() => {
      void this.runAutoSimulation(id);
    }, 0);

    return updatedSimulation;
  }

  private async runAutoSimulation(id: number) {
    try {
      const simulation = await this.prisma.simulation.findUnique({
        where: { id },
      });

      if (!simulation) {
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
        const current = await this.prisma.simulation.findUnique({
          where: { id },
        });

        if (!current || current.status === SimulationStatus.Cancelled) {
          return;
        }

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
      }
      await this.aggregateSimulation(id);
    } catch (error) {
      await this.prisma.simulation.update({
        where: { id },
        data: {
          status: SimulationStatus.Failed,
          progressPhase: 'failed',
          progressMessage: 'Auto simulation failed',
          error: getReadableError(error),
        },
      });
    }
  }

  private async createDailySimulationPlan(
    simulation: Simulation,
    range: WindowRange,
  ) {
    return await this.prisma.simulationPlan.create({
      data: {
        title: `${simulation.title} ${dayjs(range.startedAt).format(
          'YYYY-MM-DD',
        )}`,
        description: simulation.description,
        startAt: range.startedAt,
        endAt: range.endedAt,
        cursor: new Date(),
        simulationId: simulation.id,
      },
    });
  }

  private async findCandidateLeaders(
    simulation: Simulation,
    range: WindowRange,
    contractById: Map<number, ContractContext>,
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
    const recentActivityCutoff = dayjs(range.startedAt)
      .subtract(CANDIDATE_RECENT_ACTIVITY_DAYS, 'day')
      .toDate();
    const prefilteredAddresses: string[] = [];

    for (
      let offset = 0;
      offset < candidateAddresses.length;
      offset += CANDIDATE_PREFILTER_BATCH_SIZE
    ) {
      const addressBatch = candidateAddresses.slice(
        offset,
        offset + CANDIDATE_PREFILTER_BATCH_SIZE,
      );
      const recentLogsByAddress = await Promise.all(
        addressBatch.map(async (address) => {
          const logs = await this.prisma.perpTradingEventLog.findMany({
            where: {
              platform: simulation.platform,
              address,
              date: {
                lt: range.startedAt,
              },
            },
            orderBy: [{ date: 'desc' }, { block: 'desc' }, { id: 'desc' }],
            take: simulation.minTrades,
          });

          return {
            address,
            logs,
          };
        }),
      );

      recentLogsByAddress.forEach(({ address, logs }) => {
        const latestLog = logs[0];
        const sampledPositions =
          this.eventLogsService.convertToPerpTradePositionsWithSummary(
            simulation.platform,
            this.eventLogsToHistories(logs, contractById),
            {
              maxLeverage: simulation.maxLeverage,
            },
          ).positions;
        const closedPositionCount = sampledPositions.filter((position) =>
          this.isClosedPosition(position),
        ).length;

        if (closedPositionCount < simulation.minTrades) {
          return;
        }

        if (!latestLog || latestLog.date < recentActivityCutoff) {
          return;
        }

        prefilteredAddresses.push(address);
      });
    }

    return prefilteredAddresses;
  }

  private async selectLeadersForRange(
    simulation: Simulation,
    range: WindowRange,
    contractById: Map<number, ContractContext>,
  ) {
    const candidateLeaders = await this.findCandidateLeaders(
      simulation,
      range,
      contractById,
    );
    const evaluated: CandidateEvaluation[] = [];

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

    return evaluated
      .filter((item) => !item.rejectedReason && item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, simulation.selectedLeaderCount);
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
    contracts: { id: number }[],
  ) {
    if (selectedCandidates.length === 0 || contracts.length === 0) {
      return;
    }

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
  }

  private async aggregateSimulation(id: number) {
    const plans = await this.prisma.simulationPlan.findMany({
      where: { simulationId: id },
      orderBy: [{ startAt: 'asc' }, { id: 'asc' }],
    });
    const followerPositionPnls: number[] = [];
    let totalLeaderPnl = 0;

    for (const plan of plans) {
      const details = await this.calculateSimulationPlanDetails(plan.id);
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
        hasNextPage: edges.length > 0,
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
