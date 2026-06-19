import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  Contract,
  PlanMode,
  PlanStatus,
  Platform,
  Plan as PrismaPlan,
  TaskStatus,
} from 'generated/prisma/client';
import { Address, decodeEventLog } from 'viem';

import { PrismaService } from 'src/global/prisma.service';
import { LogsService } from 'src/global/logs.service';
import { delay, getReadableError } from 'src/utils';
import { ChainPriority } from 'src/types';
import { EvmAdapterService } from 'src/web3/web3/evm-adapter.service';
import { getWeb3Info } from 'src/web3/utils';
import { parseEvent } from 'src/web3/platform/gmx/v2/eventParsers';
import { contractAddresses as avntContractAddresses } from 'src/web3/platform/avnt/v1/configs';
import { BotsService } from 'src/microservices/apiService/modules/bots/bots.service';
import { PATTERNS, SERVICE_NAMES } from 'src/utils/constants';

import { SimulationResumeResult } from './entities/plan.entity';
import {
  SimulationTaskExecutorService,
  SimulationTaskExpectation,
} from './simulation-task-executor.service';

type SimulationPlanContext = {
  plan: PrismaPlan;
  bots: {
    leaderContract: Contract;
  }[];
};

type SimulationWindow = {
  start: Date;
  end: Date;
  isFinished: boolean;
};

type SimulationRunStats = {
  leaderActionCount: number;
  virtualActionCount: number;
  virtualTaskCount: number;
  finalizedTaskCount: number;
  stoppedTaskCount: number;
  executionIterations: number;
};

@Injectable()
export class PlanSimulationService {
  private static readonly DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;
  private static readonly MAX_EXECUTION_ITERATIONS = 20;
  private static readonly SIMULATION_CHUNK_BLOCKSIZE = 1200n;
  private static readonly SIMULATION_CHUNK_DELAY_MS = 1_000;
  private readonly runUsers = new Map<string, string>();

  constructor(
    @Inject(SERVICE_NAMES.REDIS_SERVICE) private redisClient: ClientProxy,
    private readonly prisma: PrismaService,
    private readonly evmAdapterService: EvmAdapterService,
    private readonly botsService: BotsService,
    private readonly simulationTaskExecutorService: SimulationTaskExecutorService,
    private readonly logger: LogsService,
  ) {}

  async resume(
    userId: string,
    planId: number,
    speed: number,
  ): Promise<SimulationResumeResult> {
    this.assertSimulationSpeed(speed);

    const context = await this.loadSimulationContext(userId, planId);
    const window = this.buildNextSimulationWindow(context);
    const runId = `${planId}:${Date.now()}`;
    this.runUsers.set(runId, userId);

    await this.debug(runId, planId, 'accepted-request', {
      userId,
      status: 'Accepted',
      message: 'Simulation resume request accepted',
      percent: 1,
      speed,
      planStatus: context.plan.status,
      scheduledStart: context.plan.scheduledStart,
      scheduledEnd: context.plan.scheduledEnd,
      simulationCursor: context.plan.simulationCursor,
      botCount: context.bots.length,
      leaderContractCount: this.getLeaderContracts(context).length,
      window,
    });

    if (context.plan.status === PlanStatus.Started) {
      await this.debug(runId, planId, 'already-running', {
        userId,
        status: 'Rejected',
        percent: 100,
        message: 'Rejecting duplicate resume request while plan is Started',
      });
      this.runUsers.delete(runId);

      return {
        accepted: false,
        message: 'Simulation is already running',
        windowStart: window.start,
        windowEnd: window.end,
        ...this.emptyStats(),
        plan: context.plan,
      };
    }

    if (window.isFinished) {
      const plan = await this.markSimulationFinished(context.plan.id);
      await this.publishPlanUpdated(plan);
      await this.debug(runId, planId, 'already-finished', {
        userId,
        status: 'Finished',
        message: 'Simulation is already at the scheduled end',
        percent: 100,
        cursor: window.start,
        scheduledEnd: context.plan.scheduledEnd,
      });
      this.runUsers.delete(runId);

      return {
        accepted: false,
        message: 'Simulation plan has already reached its scheduled end',
        windowStart: window.start,
        windowEnd: window.end,
        ...this.emptyStats(),
        plan,
      };
    }

    const runningPlan = await this.markSimulationRunning(context.plan.id);
    await this.publishPlanUpdated(runningPlan);
    const stats = this.emptyStats();

    await this.debug(runId, planId, 'background-task-started', {
      userId,
      status: 'Running',
      message: 'Simulation background task started',
      percent: 5,
      windowStart: window.start,
      windowEnd: window.end,
      speed,
    });

    void this.runResumeTask(runId, context, window, speed, runningPlan.id);

    return {
      accepted: true,
      message: `Simulation window accepted at ${speed}x. Subscribe to planUpdated and newLog for progress.`,
      windowStart: window.start,
      windowEnd: window.end,
      ...stats,
      plan: runningPlan,
    };
  }

  private async runResumeTask(
    runId: string,
    context: SimulationPlanContext,
    window: SimulationWindow,
    speed: number,
    runningPlanId: number,
  ) {
    const stats = this.emptyStats();

    try {
      await this.debug(runId, context.plan.id, 'run-started', {
        status: 'Running',
        message: 'Simulation run started',
        percent: 8,
        windowStart: window.start,
        windowEnd: window.end,
        speed,
      });

      stats.leaderActionCount = await this.replayLeaderEvents(
        runId,
        context,
        window,
        speed,
      );
      const executionStats = await this.executeVirtualFollowerActions(
        runId,
        context,
        window,
      );
      Object.assign(stats, {
        ...stats,
        ...executionStats,
        leaderActionCount: stats.leaderActionCount,
      });
      await this.projectSimulationReport(context, window);

      const plan = await this.markSimulationPausedAtCursor(
        runningPlanId,
        window.end,
      );
      await this.publishPlanUpdated(plan);
      await this.debug(runId, context.plan.id, 'run-completed', {
        status: 'Completed',
        message: `Simulation window completed: ${stats.leaderActionCount} leader actions, ${stats.virtualActionCount} virtual actions`,
        percent: 100,
        windowStart: window.start,
        windowEnd: window.end,
        stats,
        planStatus: plan.status,
        simulationCursor: plan.simulationCursor,
      });
    } catch (err) {
      const plan = await this.markSimulationPausedAtCursor(
        context.plan.id,
        window.start,
      );
      await this.publishPlanUpdated(plan);
      await this.logger.log({
        severity: 'Error',
        summary: 'PlanSimulationService>resume',
        details: JSON.stringify({
          runId,
          planId: context.plan.id,
          windowStart: window.start,
          windowEnd: window.end,
          stats,
          error: getReadableError(err),
        }),
      });
      await this.debug(runId, context.plan.id, 'run-failed', {
        status: 'Failed',
        message: 'Simulation run failed and was paused at the previous cursor',
        percent: 100,
        windowStart: window.start,
        windowEnd: window.end,
        stats,
        error: getReadableError(err),
      });
    } finally {
      this.runUsers.delete(runId);
    }
  }

  private emptyStats(): SimulationRunStats {
    return {
      leaderActionCount: 0,
      virtualActionCount: 0,
      virtualTaskCount: 0,
      finalizedTaskCount: 0,
      stoppedTaskCount: 0,
      executionIterations: 0,
    };
  }

  private assertSimulationSpeed(speed: number) {
    if (!Number.isInteger(speed) || speed < 1) {
      throw new Error('Simulation speed must be a positive integer');
    }
  }

  private async loadSimulationContext(userId: string, planId: number) {
    const plan = await this.prisma.plan.findUnique({
      where: {
        id: planId,
        userId,
      },
      include: {
        bots: {
          include: {
            follower: true,
            strategy: true,
            leaderContract: true,
            followerContract: true,
          },
        },
      },
    });

    if (!plan) {
      throw new Error('Simulation plan not found');
    }

    if (plan.mode !== PlanMode.Simulation) {
      throw new Error('Plan is not a simulation plan');
    }

    return {
      plan,
      bots: plan.bots,
    };
  }

  private buildNextSimulationWindow(
    context: SimulationPlanContext,
  ): SimulationWindow {
    const cursor = context.plan.simulationCursor || context.plan.scheduledStart;
    const cappedEnd = new Date(
      Math.min(
        cursor.getTime() + PlanSimulationService.DEFAULT_WINDOW_MS,
        context.plan.scheduledEnd.getTime(),
      ),
    );

    return {
      start: cursor,
      end: cappedEnd,
      isFinished: cursor.getTime() >= context.plan.scheduledEnd.getTime(),
    };
  }

  private async markSimulationPausedAtCursor(planId: number, cursor: Date) {
    return await this.prisma.plan.update({
      where: {
        id: planId,
      },
      data: {
        status: PlanStatus.Stopped,
        simulationCursor: cursor,
      },
    });
  }

  private async markSimulationRunning(planId: number) {
    return await this.prisma.plan.update({
      where: {
        id: planId,
      },
      data: {
        status: PlanStatus.Started,
      },
    });
  }

  private async markSimulationFinished(planId: number) {
    return await this.prisma.plan.update({
      where: {
        id: planId,
      },
      data: {
        status: PlanStatus.Finished,
        endedAt: new Date(),
      },
    });
  }

  private async replayLeaderEvents(
    runId: string,
    context: SimulationPlanContext,
    window: SimulationWindow,
    speed: number,
  ) {
    const contracts = this.getLeaderContracts(context);
    let actionCount = 0;

    for (
      let contractIndex = 0;
      contractIndex < contracts.length;
      contractIndex++
    ) {
      const contract = contracts[contractIndex];
      const progressContext = this.getContractProgressContext(
        contract,
        contractIndex,
        contracts.length,
      );

      await this.debug(runId, context.plan.id, 'leader-contract-started', {
        status: 'Running',
        message: `Scanning ${contract.platform} leader contract ${contract.id}`,
        percent: this.getLeaderGlobalPercent(
          contractIndex,
          contracts.length,
          0,
        ),
        contractPercent: 0,
        ...progressContext,
        contractVersion: contract.version,
        contractChainId: contract.chainId,
        fromBlock: contract.fromBlock,
      });
      const fromBlock = await this.findBlockByTimestamp(contract, window.start);
      const exclusiveEndBlock = await this.findBlockByTimestamp(
        contract,
        window.end,
      );
      const toBlock =
        exclusiveEndBlock > fromBlock ? exclusiveEndBlock - 1n : fromBlock;

      if (toBlock < fromBlock) {
        await this.debug(
          runId,
          context.plan.id,
          'leader-contract-empty-range',
          {
            status: 'Running',
            message: `No block range to scan for leader contract ${contract.id}`,
            percent: this.getLeaderGlobalPercent(
              contractIndex,
              contracts.length,
              100,
            ),
            contractPercent: 100,
            ...progressContext,
            fromBlock: fromBlock.toString(),
            toBlock: toBlock.toString(),
          },
        );
        continue;
      }

      await this.debug(runId, context.plan.id, 'leader-contract-block-range', {
        status: 'Running',
        message: `Resolved scan block range for leader contract ${contract.id}`,
        percent: this.getLeaderGlobalPercent(
          contractIndex,
          contracts.length,
          5,
        ),
        contractPercent: 5,
        ...progressContext,
        fromBlock: fromBlock.toString(),
        exclusiveEndBlock: exclusiveEndBlock.toString(),
        toBlock: toBlock.toString(),
      });

      let chunkFromBlock = fromBlock;
      const chunkBlockSize = PlanSimulationService.SIMULATION_CHUNK_BLOCKSIZE;
      const totalBlocks = Number(toBlock - fromBlock + 1n);

      while (chunkFromBlock <= toBlock) {
        const chunkToBlock =
          chunkFromBlock + chunkBlockSize - 1n < toBlock
            ? chunkFromBlock + chunkBlockSize - 1n
            : toBlock;
        const chunkStartPercent = this.getContractBlockPercent(
          fromBlock,
          chunkFromBlock - 1n,
          totalBlocks,
        );
        const chunkEndPercent = this.getContractBlockPercent(
          fromBlock,
          chunkToBlock,
          totalBlocks,
        );

        await this.debug(runId, context.plan.id, 'leader-chunk-scan-started', {
          status: 'Running',
          message: `Scanning chain logs for blocks ${chunkFromBlock.toString()}-${chunkToBlock.toString()}`,
          percent: this.getLeaderGlobalPercent(
            contractIndex,
            contracts.length,
            chunkStartPercent,
          ),
          contractPercent: chunkStartPercent,
          ...progressContext,
          fromBlock: chunkFromBlock.toString(),
          toBlock: chunkToBlock.toString(),
        });

        const actionItems = await this.scanActionItems(
          contract,
          chunkFromBlock,
          chunkToBlock,
        );

        await this.debug(runId, context.plan.id, 'leader-chunk-scan-finished', {
          status: 'Running',
          message: `Scanned chain chunk with ${actionItems.length} action items`,
          percent: this.getLeaderGlobalPercent(
            contractIndex,
            contracts.length,
            chunkEndPercent,
          ),
          contractPercent: chunkEndPercent,
          ...progressContext,
          fromBlock: chunkFromBlock.toString(),
          toBlock: chunkToBlock.toString(),
          actionItemCount: actionItems.length,
          firstAction:
            actionItems.length > 0
              ? {
                  name: actionItems[0].item.name,
                  blockNumber: actionItems[0].blockNumber,
                  logIndex: actionItems[0].logIndex,
                }
              : null,
          lastAction:
            actionItems.length > 0
              ? {
                  name: actionItems[actionItems.length - 1].item.name,
                  blockNumber: actionItems[actionItems.length - 1].blockNumber,
                  logIndex: actionItems[actionItems.length - 1].logIndex,
                }
              : null,
        });

        if (actionItems.length > 0) {
          actionCount += actionItems.length;

          await this.botsService.handleActionItems(contract, actionItems, {
            planMode: PlanMode.Simulation,
            planId: context.plan.id,
          });

          await this.debug(runId, context.plan.id, 'leader-actions-handled', {
            status: 'Running',
            message: `Handled ${actionItems.length} leader action items`,
            percent: this.getLeaderGlobalPercent(
              contractIndex,
              contracts.length,
              chunkEndPercent,
            ),
            contractPercent: chunkEndPercent,
            ...progressContext,
            actionItemCount: actionItems.length,
            cumulativeLeaderActionCount: actionCount,
          });
        }

        chunkFromBlock = chunkToBlock + 1n;

        if (chunkFromBlock <= toBlock) {
          await this.debug(runId, context.plan.id, 'leader-chunk-delay', {
            status: 'Running',
            message: 'Waiting before scanning the next simulation chunk',
            percent: this.getLeaderGlobalPercent(
              contractIndex,
              contracts.length,
              chunkEndPercent,
            ),
            contractPercent: chunkEndPercent,
            ...progressContext,
            speed,
            nextFromBlock: chunkFromBlock.toString(),
          });
          await this.delaySimulationChunk(speed);
        }
      }
    }

    return actionCount;
  }

  private async delaySimulationChunk(speed: number) {
    const delayMs = Math.floor(
      PlanSimulationService.SIMULATION_CHUNK_DELAY_MS / speed,
    );

    if (delayMs > 0) {
      await delay(delayMs);
    }
  }

  private async executeVirtualFollowerActions(
    runId: string,
    context: SimulationPlanContext,
    _window: SimulationWindow,
  ): Promise<Omit<SimulationRunStats, 'leaderActionCount'>> {
    const stats: Omit<SimulationRunStats, 'leaderActionCount'> = {
      virtualActionCount: 0,
      virtualTaskCount: 0,
      finalizedTaskCount: 0,
      stoppedTaskCount: 0,
      executionIterations: 0,
    };

    for (
      let iteration = 1;
      iteration <= PlanSimulationService.MAX_EXECUTION_ITERATIONS;
      iteration++
    ) {
      await this.debug(runId, context.plan.id, 'virtual-execution-started', {
        status: 'Running',
        message: `Executing virtual follower tasks, iteration ${iteration}`,
        percent: 65,
        iteration,
      });
      const result = await this.simulationTaskExecutorService.executePlanWindow(
        context.plan.id,
      );

      await this.debug(runId, context.plan.id, 'virtual-execution-finished', {
        status: 'Running',
        message: `Virtual execution iteration ${iteration} produced ${result.expectations.length} expectations`,
        percent: 75,
        iteration,
        expectationCount: result.expectations.length,
        groupCount: result.groups.length,
        virtualActionCount: result.groups.reduce(
          (sum, group) => sum + group.actionItems.length,
          0,
        ),
        expectations: result.expectations.map((expectation) => ({
          taskId: expectation.taskId,
          expectedStatus: expectation.expectedStatus,
          message: expectation.message,
        })),
      });

      if (result.expectations.length === 0) {
        break;
      }

      stats.executionIterations = iteration;
      stats.virtualTaskCount += result.expectations.length;
      stats.virtualActionCount += result.groups.reduce(
        (sum, group) => sum + group.actionItems.length,
        0,
      );

      for (const group of result.groups) {
        await this.botsService.handleActionItems(
          group.contract,
          group.actionItems,
          {
            planMode: PlanMode.Simulation,
            planId: context.plan.id,
          },
        );
      }

      const finalizationStats = await this.assertSimulationTaskExpectations(
        result.expectations,
      );
      stats.finalizedTaskCount += finalizationStats.finalizedTaskCount;
      stats.stoppedTaskCount += finalizationStats.stoppedTaskCount;

      await this.debug(
        runId,
        context.plan.id,
        'virtual-expectations-asserted',
        {
          status: 'Running',
          message: `Asserted virtual task expectations for iteration ${iteration}`,
          percent: 85,
          iteration,
          finalizationStats,
          cumulativeStats: stats,
        },
      );
    }

    await this.assertNoDanglingSimulationTasks(context.plan.id);
    await this.debug(runId, context.plan.id, 'dangling-task-check-passed', {
      status: 'Running',
      message: 'No dangling simulation tasks found',
      percent: 95,
      stats,
    });

    return stats;
  }

  private async assertSimulationTaskExpectations(
    expectations: SimulationTaskExpectation[],
  ): Promise<
    Pick<SimulationRunStats, 'finalizedTaskCount' | 'stoppedTaskCount'>
  > {
    const stats = {
      finalizedTaskCount: 0,
      stoppedTaskCount: 0,
    };

    if (expectations.length === 0) {
      return stats;
    }

    const tasks = await this.prisma.task.findMany({
      where: {
        id: {
          in: expectations.map((item) => item.taskId),
        },
      },
      select: {
        id: true,
        status: true,
      },
    });
    const taskStatusMap = new Map(tasks.map((task) => [task.id, task.status]));
    const failedExpectations = expectations.filter(
      (expectation) =>
        taskStatusMap.get(expectation.taskId) !== expectation.expectedStatus,
    );

    if (failedExpectations.length > 0) {
      throw new Error(
        `Simulation task finalization failed: ${failedExpectations
          .map(
            (item) =>
              `task ${item.taskId} expected ${item.expectedStatus}, got ${taskStatusMap.get(
                item.taskId,
              )}`,
          )
          .join('; ')}`,
      );
    }

    for (const expectation of expectations) {
      if (expectation.expectedStatus === TaskStatus.Completed) {
        stats.finalizedTaskCount += 1;
      }

      if (expectation.expectedStatus === TaskStatus.Stopped) {
        stats.stoppedTaskCount += 1;
      }
    }

    return stats;
  }

  private async assertNoDanglingSimulationTasks(planId: number) {
    const danglingTasks = await this.prisma.task.findMany({
      where: {
        status: {
          in: [TaskStatus.Created, TaskStatus.Await, TaskStatus.Initiated],
        },
        mission: {
          bot: {
            planId,
            plan: {
              mode: PlanMode.Simulation,
            },
          },
        },
      },
      include: {
        action: true,
      },
      take: 10,
      orderBy: [{ id: 'asc' }],
    });

    if (danglingTasks.length > 0) {
      throw new Error(
        `Simulation left dangling tasks: ${danglingTasks
          .map((task) => `task ${task.id} ${task.status} ${task.action.name}`)
          .join('; ')}`,
      );
    }
  }

  private async projectSimulationReport(
    _context: SimulationPlanContext,
    _window: SimulationWindow,
  ) {
    // Placeholder for PnL points, open/closed positions, and bot performance
    // projections after each resumed simulation window.
  }

  private async publishPlanUpdated(plan: SimulationResumeResult['plan']) {
    await this.redisClient.emit(PATTERNS.Plans.PlanUpdated, plan);
  }

  private async debug(
    runId: string,
    planId: number,
    phase: string,
    details: Record<string, unknown>,
  ) {
    const progress = await this.createProgressLog(
      runId,
      planId,
      phase,
      details,
    );

    await this.logger.log({
      severity: 'Debug',
      summary: `PlanSimulationService>${phase}`,
      details: JSON.stringify(
        {
          runId,
          planId,
          phase,
          ...details,
        },
        (_key, value) => (typeof value === 'bigint' ? value.toString() : value),
      ),
    });

    await this.redisClient.emit(
      PATTERNS.Plans.SimulationProgressUpdated,
      progress,
    );
  }

  private async createProgressLog(
    runId: string,
    planId: number,
    phase: string,
    details: Record<string, unknown>,
  ) {
    const stats = this.extractStats(details);
    const userId =
      typeof details.userId === 'string'
        ? details.userId
        : this.runUsers.get(runId) || '';

    return await this.prisma.simulationProgressLog.create({
      data: {
        planId,
        userId,
        runId,
        phase,
        status: typeof details.status === 'string' ? details.status : 'Running',
        message:
          typeof details.message === 'string'
            ? details.message
            : this.humanizePhase(phase),
        details: JSON.stringify(details, (_key, value) =>
          typeof value === 'bigint' ? value.toString() : value,
        ),
        percent:
          typeof details.percent === 'number'
            ? Math.max(0, Math.min(100, details.percent))
            : 0,
        windowStart:
          details.windowStart instanceof Date ? details.windowStart : null,
        windowEnd: details.windowEnd instanceof Date ? details.windowEnd : null,
        contractId: this.toNullableStatNumber(details.contractId),
        contractAddress:
          typeof details.contractAddress === 'string'
            ? details.contractAddress
            : null,
        contractPlatform:
          typeof details.contractPlatform === 'string'
            ? details.contractPlatform
            : null,
        contractIndex: this.toNullableStatNumber(details.contractIndex),
        contractCount: this.toNullableStatNumber(details.contractCount),
        contractPercent: this.toNullableStatNumber(details.contractPercent),
        ...stats,
      },
    });
  }

  private extractStats(details: Record<string, unknown>): SimulationRunStats {
    const rawStats =
      details.stats && typeof details.stats === 'object'
        ? (details.stats as Partial<SimulationRunStats>)
        : details;

    return {
      leaderActionCount: this.toStatNumber(rawStats.leaderActionCount),
      virtualActionCount: this.toStatNumber(rawStats.virtualActionCount),
      virtualTaskCount: this.toStatNumber(rawStats.virtualTaskCount),
      finalizedTaskCount: this.toStatNumber(rawStats.finalizedTaskCount),
      stoppedTaskCount: this.toStatNumber(rawStats.stoppedTaskCount),
      executionIterations: this.toStatNumber(rawStats.executionIterations),
    };
  }

  private toStatNumber(value: unknown) {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }

  private toNullableStatNumber(value: unknown) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  private humanizePhase(phase: string) {
    return phase
      .split('-')
      .map((item) => item.charAt(0).toUpperCase() + item.slice(1))
      .join(' ');
  }

  private getContractProgressContext(
    contract: Contract,
    contractIndex: number,
    contractCount: number,
  ) {
    return {
      contractId: contract.id,
      contractAddress: contract.address,
      contractPlatform: contract.platform,
      contractIndex: contractIndex + 1,
      contractCount,
    };
  }

  private getContractBlockPercent(
    fromBlock: bigint,
    processedToBlock: bigint,
    totalBlocks: number,
  ) {
    if (totalBlocks <= 0 || processedToBlock < fromBlock) {
      return 0;
    }

    const processedBlocks = Number(processedToBlock - fromBlock + 1n);

    return Math.max(
      0,
      Math.min(100, Math.round((processedBlocks / totalBlocks) * 100)),
    );
  }

  private getLeaderGlobalPercent(
    contractIndex: number,
    contractCount: number,
    contractPercent: number,
  ) {
    if (contractCount <= 0) {
      return 65;
    }

    const leaderStartPercent = 10;
    const leaderEndPercent = 65;
    const contractSpan =
      (leaderEndPercent - leaderStartPercent) / contractCount;
    const completedContractsPercent = contractIndex * contractSpan;
    const currentContractPercent =
      (Math.max(0, Math.min(100, contractPercent)) / 100) * contractSpan;

    return Math.round(
      leaderStartPercent + completedContractsPercent + currentContractPercent,
    );
  }

  private getLeaderContracts(context: SimulationPlanContext) {
    const contracts = new Map<number, Contract>();

    for (const bot of context.bots) {
      contracts.set(bot.leaderContract.id, bot.leaderContract);
    }

    return Array.from(contracts.values());
  }

  private async findBlockByTimestamp(contract: Contract, timestamp: Date) {
    const targetTimestamp = BigInt(Math.floor(timestamp.getTime() / 1000));
    const latestBlockNumber = await this.evmAdapterService.getBlockNumber({
      chainId: contract.chainId,
      priority: ChainPriority.HIGH,
    });

    let low = BigInt(contract.fromBlock);
    let high = latestBlockNumber;
    let answer = latestBlockNumber;

    while (low <= high) {
      const mid = (low + high) / 2n;
      const block = await this.evmAdapterService.getValidBlock({
        chainId: contract.chainId,
        priority: ChainPriority.LOW,
        blockNumber: mid,
      });

      if (block.timestamp >= targetTimestamp) {
        answer = mid;
        high = mid - 1n;
      } else {
        low = mid + 1n;
      }
    }

    return answer;
  }

  private async scanActionItems(
    contract: Contract,
    fromBlock: bigint,
    toBlock: bigint,
  ) {
    const logs = (
      await this.evmAdapterService.getLogs({
        chainId: contract.chainId,
        priority: ChainPriority.HIGH,
        address: contract.address as Address,
        fromBlock,
        toBlock,
      })
    ).filter((log) => log.topics.length > 0);

    if (contract.platform === Platform.AVNT) {
      await delay(1_000);
      const additionalLogs = (
        await this.evmAdapterService.getLogs({
          chainId: contract.chainId,
          priority: ChainPriority.HIGH,
          address: avntContractAddresses.Trading as `0x${string}`,
          fromBlock,
          toBlock,
        })
      ).filter((log) => log.topics.length > 0);

      logs.push(...additionalLogs);
    }

    return logs
      .filter((log) => {
        const info = getWeb3Info(contract.platform, contract.version);

        return info.eventSignatures
          ? info.eventSignatures[log.topics[0] as string]
          : true;
      })
      .map((log) => {
        try {
          const decoded: any = decodeEventLog({
            abi: getWeb3Info(contract.platform, contract.version).abi,
            data: log.data,
            topics: log.topics,
          });

          let eventLog = decoded;

          if (contract.platform === Platform.GMX) {
            eventLog = parseEvent(
              decoded.args.eventName,
              decoded.args.eventData,
            );
          }

          return {
            eventLog,
            blockNumber: Number(log.blockNumber),
            logIndex: Number(log.logIndex),
            blockHash: log.blockHash ? String(log.blockHash) : null,
            txHash: log.transactionHash ? String(log.transactionHash) : null,
          };
        } catch {
          return null;
        }
      })
      .filter((item) => !!item)
      .sort((a, b) => {
        if (a.blockNumber === b.blockNumber) {
          return a.logIndex - b.logIndex;
        } else {
          return a.blockNumber - b.blockNumber;
        }
      })
      .filter((log) =>
        getWeb3Info(
          contract.platform,
          contract.version,
        ).tradeEventNames.includes(log.eventLog.eventName),
      )
      .map((log) => ({
        item: getWeb3Info(
          contract.platform,
          contract.version,
        ).eventToActionParser(log.eventLog as any),
        blockNumber: log.blockNumber,
        logIndex: log.logIndex,
        blockHash: log.blockHash,
        txHash: log.txHash,
      }));
  }
}
