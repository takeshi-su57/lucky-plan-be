import { Injectable } from '@nestjs/common';
import {
  Contract,
  PlanMode,
  PlanStatus,
  Platform,
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

import { SimulationResumeResult } from './entities/plan.entity';
import {
  SimulationTaskExecutorService,
  SimulationTaskExpectation,
} from './simulation-task-executor.service';

type SimulationPlanContext = {
  plan: {
    id: number;
    userId: string;
    mode: PlanMode;
    status: PlanStatus;
    scheduledStart: Date;
    scheduledEnd: Date;
    simulationCursor: Date | null;
  };
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
  private static readonly SIMULATION_CHUNK_BLOCKSIZE = 400n;
  private static readonly SIMULATION_CHUNK_DELAY_MS = 4_000;

  constructor(
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

    if (window.isFinished) {
      const plan = await this.markSimulationFinished(context.plan.id);

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
    const stats = this.emptyStats();

    try {
      stats.leaderActionCount = await this.replayLeaderEvents(
        context,
        window,
        speed,
      );
      const executionStats = await this.executeVirtualFollowerActions(
        context,
        window,
      );
      Object.assign(stats, {
        ...stats,
        ...executionStats,
        leaderActionCount: stats.leaderActionCount,
      });
      await this.projectSimulationReport(context, window);
    } catch (err) {
      await this.markSimulationPausedAtCursor(context.plan.id, window.start);
      await this.logger.log({
        severity: 'Error',
        summary: 'PlanSimulationService>resume',
        details: getReadableError(err),
      });

      throw err;
    }

    return {
      accepted: true,
      message: `Simulation window completed at ${speed}x: ${stats.leaderActionCount} leader actions replayed, ${stats.virtualActionCount} virtual follower actions generated`,
      windowStart: window.start,
      windowEnd: window.end,
      ...stats,
      plan: await this.markSimulationPausedAtCursor(runningPlan.id, window.end),
    };
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
    context: SimulationPlanContext,
    window: SimulationWindow,
    speed: number,
  ) {
    const contracts = this.getLeaderContracts(context);
    let actionCount = 0;

    for (const contract of contracts) {
      const fromBlock = await this.findBlockByTimestamp(contract, window.start);
      const exclusiveEndBlock = await this.findBlockByTimestamp(
        contract,
        window.end,
      );
      const toBlock =
        exclusiveEndBlock > fromBlock ? exclusiveEndBlock - 1n : fromBlock;

      if (toBlock < fromBlock) {
        continue;
      }

      let chunkFromBlock = fromBlock;
      const chunkBlockSize = PlanSimulationService.SIMULATION_CHUNK_BLOCKSIZE;

      while (chunkFromBlock <= toBlock) {
        const chunkToBlock =
          chunkFromBlock + chunkBlockSize - 1n < toBlock
            ? chunkFromBlock + chunkBlockSize - 1n
            : toBlock;

        const actionItems = await this.scanActionItems(
          contract,
          chunkFromBlock,
          chunkToBlock,
        );

        if (actionItems.length > 0) {
          actionCount += actionItems.length;

          await this.botsService.handleActionItems(contract, actionItems, {
            planMode: PlanMode.Simulation,
            planId: context.plan.id,
          });
        }

        chunkFromBlock = chunkToBlock + 1n;

        if (chunkFromBlock <= toBlock) {
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
      const result = await this.simulationTaskExecutorService.executePlanWindow(
        context.plan.id,
      );

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
    }

    await this.assertNoDanglingSimulationTasks(context.plan.id);

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
