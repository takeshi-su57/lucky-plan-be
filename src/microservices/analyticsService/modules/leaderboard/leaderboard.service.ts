import { Injectable } from '@nestjs/common';
import { Address, Block, decodeEventLog, PublicClient } from 'viem';
import { Contract, ContractStatus, Platform } from 'generated/prisma/client';

import { getReadableError } from 'src/utils';
import { ChainPriority, ServiceStatus } from 'src/types';

import { ContractsService } from 'src/microservices/apiService/modules/contracts/contracts.service';
import { LogsService } from 'src/global/logs.service';
import { EvmAdapterService } from 'src/web3/web3/evm-adapter.service';
import { EventLogsService } from 'src/microservices/apiService/modules/trade-histories/event-logs.service';
import { PrismaService } from 'src/global/prisma.service';
import { EvmChainsService } from 'src/web3/web3/evm-chains.service';
import { CreatePerpTradingEventLogInput } from 'src/microservices/apiService/modules/trade-histories/dto/event-logs.input';
import { contractAddresses as avntContractAddresses } from 'src/web3/platform/avnt/v1/configs';

import { parseEvent } from 'src/web3/platform/gmx/v2/eventParsers';

import { getWeb3Info } from 'src/web3/utils';
import { delay } from 'src/utils';

import { avntGeneralAbi } from 'src/web3/platform/avnt/v1/abi/AvntGeneral';

type AggressiveAdaptionOptions = {
  basePenaltyMs?: number;
  maxPenaltyMs?: number;
};

type AggressiveTask = {
  fromBlock: bigint;
  toBlock: bigint;
  status: 'created' | 'processing' | 'failed' | 'completed';
  attempts: number;
};

type AggressiveWorker = {
  id: string;
  url: string;
  client: PublicClient;
  isBusy: boolean;
  penaltyLevel: number;
  availableAt: number;
};

@Injectable()
export class LeaderboardService {
  isReceivedKillProcess = false;
  status: Record<number, ServiceStatus> = {};

  static BATCH_SIZE = 4000n;

  constructor(
    private readonly evmAdapterService: EvmAdapterService,
    private readonly evmChainsService: EvmChainsService,
    private readonly contractsService: ContractsService,
    private readonly eventLogsService: EventLogsService,
    private readonly logger: LogsService,
    private readonly prismaService: PrismaService,
  ) {
    this.isReceivedKillProcess = false;
  }

  getAllStatus() {
    return this.status;
  }

  async checkContractsForLeaderboard() {
    const contracts = await this.contractsService.findAll();

    const promises = contracts
      .filter((contract) => contract.status === ContractStatus.Live)
      .map(async (contract) => await this.startAdaption(contract.id, false));

    await Promise.allSettled(promises);
  }

  async cronAdaption(contractId: number, shouldRestart: boolean) {
    if (this.status[contractId] === ServiceStatus.PROCESS) {
      return;
    }

    this.status[contractId] = ServiceStatus.PROCESS;

    try {
      const contract = await this.contractsService.findOne(contractId);

      const currentBlock = await this.evmAdapterService.getLatestFinalizedBlock(
        {
          chainId: contract.chainId,
          priority: ChainPriority.HIGH,
        },
      );

      let fromBlock = shouldRestart
        ? BigInt(contract.fromBlock)
        : BigInt(contract.lastLeaderboardBlockNumber) + 1n;

      const endBlock = contract.toBlock
        ? BigInt(contract.toBlock)
        : currentBlock.number;

      if (shouldRestart) {
        await this.cleanLogs(contract.id, Number(fromBlock), Number(endBlock));
      }

      this.logger.log({
        severity: 'Info',
        summary: 'leaderboard>startAdaption',
        details: `chainId:${contract.chainId} contractId:${contractId} block:${Number(fromBlock)} - ${Number(endBlock)}`,
      });

      while (fromBlock <= endBlock) {
        const toBlock =
          fromBlock + LeaderboardService.BATCH_SIZE < endBlock
            ? fromBlock + LeaderboardService.BATCH_SIZE
            : endBlock;

        this.logger.log({
          severity: 'Info',
          summary: 'leaderboard>startAdaption',
          details: `chainId:${contract.chainId} contractId:${contractId} block:${Number(fromBlock)} - ${Number(toBlock)}`,
        });

        if (this.isReceivedKillProcess) {
          this.logger.log({
            severity: 'Info',
            summary: 'leaderboard>startAdaption',
            details: `killed by gnsService stopped or kill process received`,
          });

          break;
        }

        const eventLogs = await this.fetchEventLogs({
          contract,
          getLogs: async (address) =>
            await this.evmAdapterService.getLogs({
              chainId: contract.chainId,
              priority: ChainPriority.HIGH,
              address,
              fromBlock,
              toBlock,
            }),
        });

        const block = await this.evmAdapterService.getValidBlock({
          chainId: contract.chainId,
          priority: ChainPriority.HIGH,
          blockNumber: fromBlock,
        });

        const perpTradeEventLogs = eventLogs.filter((log) =>
          getWeb3Info(
            contract.platform,
            contract.version,
          ).tradeEventNames.includes(log.eventLog.eventName),
        );

        await this.handlePerpTradeEventLogs({
          contract,
          block,
          perpTradeEventLogs,
        });

        await this.contractsService.updateLastLeaderboardBlockNumber(
          contract.id,
          Number(toBlock),
        );

        fromBlock = toBlock + 1n;
      }
    } catch (err) {
      this.logger.log({
        severity: 'Error',
        summary: 'leaderboard>startAdaption',
        details: `contractId:${contractId} ${getReadableError(err)}`,
      });
    }

    this.logger.log({
      severity: 'Info',
      summary: 'leaderboard>startAdaption',
      details: `finished contractId:${contractId}`,
    });

    this.status[contractId] = ServiceStatus.READY;
  }

  async startAdaption(
    contractId: number,
    shouldRestart: boolean,
    options: AggressiveAdaptionOptions = {},
  ) {
    if (this.status[contractId] === ServiceStatus.PROCESS) {
      return;
    }

    this.status[contractId] = ServiceStatus.PROCESS;

    try {
      const contract = await this.contractsService.findOne(contractId);
      const currentBlock = await this.evmAdapterService.getLatestFinalizedBlock(
        {
          chainId: contract.chainId,
          priority: ChainPriority.HIGH,
        },
      );

      const fromBlock = shouldRestart
        ? BigInt(contract.fromBlock)
        : BigInt(contract.lastLeaderboardBlockNumber) + 1n;
      const endBlock = contract.toBlock
        ? BigInt(contract.toBlock)
        : currentBlock.number;

      if (shouldRestart) {
        await this.cleanLogs(contract.id, Number(fromBlock), Number(endBlock));
      }

      const workers = this.evmChainsService
        .getAggressivePublicClients(contract.chainId)
        .map((worker) => ({
          id: worker.id,
          url: worker.url,
          client: worker.client,
          isBusy: false,
          penaltyLevel: 0,
          availableAt: 0,
        }));

      if (workers.length === 0) {
        throw new Error(`No aggressive public clients for ${contract.chainId}`);
      }

      this.logger.log({
        severity: 'Info',
        summary: 'leaderboard>startAggressiveAdaption',
        details: `chainId:${contract.chainId} contractId:${contractId} workers:${workers.length} block:${Number(fromBlock)} - ${Number(endBlock)}`,
      });

      await this.runAggressiveAdaptionTasks({
        contract,
        fromBlock,
        endBlock,
        workers,
        basePenaltyMs: options.basePenaltyMs ?? 1_000,
        maxPenaltyMs: options.maxPenaltyMs ?? 60 * 60_000,
      });
    } catch (err) {
      this.logger.log({
        severity: 'Error',
        summary: 'leaderboard>startAggressiveAdaption',
        details: `contractId:${contractId} ${getReadableError(err)}`,
      });
    }

    this.logger.log({
      severity: 'Info',
      summary: 'leaderboard>startAggressiveAdaption',
      details: `finished contractId:${contractId}`,
    });

    this.status[contractId] = ServiceStatus.READY;
  }

  private async runAggressiveAdaptionTasks({
    contract,
    fromBlock,
    endBlock,
    workers,
    basePenaltyMs,
    maxPenaltyMs,
  }: {
    contract: Contract;
    fromBlock: bigint;
    endBlock: bigint;
    workers: AggressiveWorker[];
    basePenaltyMs: number;
    maxPenaltyMs: number;
  }) {
    const tasks = this.createAggressiveTasks(fromBlock, endBlock);
    let nextCheckpointIndex = 0;

    await new Promise<void>((resolve) => {
      const reportInterval = setInterval(() => {
        this.reportAggressiveAdaptionTasks(contract, tasks, workers);
      }, 60_000);
      const finish = () => {
        clearInterval(reportInterval);
        resolve();
      };

      const schedule = () => {
        if (
          this.isReceivedKillProcess ||
          tasks.every((task) => task.status === 'completed')
        ) {
          finish();
          return;
        }

        const now = Date.now();
        const availableWorkers = workers.filter(
          (worker) => !worker.isBusy && worker.availableAt <= now,
        );

        for (const worker of availableWorkers) {
          const task =
            tasks.find((item) => item.status === 'failed') ||
            tasks.find((item) => item.status === 'created');

          if (!task) {
            break;
          }

          this.runAggressiveTask({
            contract,
            task,
            worker,
            basePenaltyMs,
            maxPenaltyMs,
          })
            .then(async () => {
              while (tasks[nextCheckpointIndex]?.status === 'completed') {
                await this.contractsService.updateLastLeaderboardBlockNumber(
                  contract.id,
                  Number(tasks[nextCheckpointIndex].toBlock),
                );

                this.logger.log({
                  severity: 'Info',
                  summary: 'leaderboard>startAggressiveAdaption',
                  details: `chainId:${contract.chainId} block:${Number(task.fromBlock)} - ${Number(task.toBlock)}`,
                });
                nextCheckpointIndex++;
              }
            })
            .finally(schedule);
        }

        const hasBusyWorker = workers.some((worker) => worker.isBusy);
        const hasRunnableTask = tasks.some(
          (task) => task.status === 'created' || task.status === 'failed',
        );

        if (!hasBusyWorker && hasRunnableTask) {
          const nextAvailableAt = Math.min(
            ...workers.map((worker) => worker.availableAt),
          );
          setTimeout(schedule, Math.max(nextAvailableAt - Date.now(), 1));
        }
      };

      schedule();
    });
  }

  private reportAggressiveAdaptionTasks(
    contract: Contract,
    tasks: AggressiveTask[],
    workers: AggressiveWorker[],
  ) {
    const now = Date.now();
    const report = {
      contractId: contract.id,
      chainId: contract.chainId,
      remainingTasks: tasks.filter((task) => task.status !== 'completed')
        .length,
      createdTasks: tasks.filter((task) => task.status === 'created').length,
      failedTasks: tasks.filter((task) => task.status === 'failed').length,
      processingTasks: tasks.filter((task) => task.status === 'processing')
        .length,
      completedTasks: tasks.filter((task) => task.status === 'completed')
        .length,
      workingWorkers: workers
        .filter((worker) => worker.isBusy)
        .map((worker) => this.getWorkerReport(worker)),
      availableWorkers: workers
        .filter((worker) => !worker.isBusy && worker.availableAt <= now)
        .map((worker) => this.getWorkerReport(worker)),
      penaltyWorkers: workers
        .filter((worker) => !worker.isBusy && worker.availableAt > now)
        .sort((a, b) => b.penaltyLevel - a.penaltyLevel)
        .map((worker) => ({
          ...this.getWorkerReport(worker),
          penaltyLevel: worker.penaltyLevel,
          availableInMs: Math.max(worker.availableAt - now, 0),
        })),
    };

    this.logger.log({
      severity: 'Info',
      summary: 'leaderboard>aggressiveAdaptionReport',
      details: JSON.stringify(report),
    });
  }

  private getWorkerReport(worker: AggressiveWorker) {
    return {
      id: worker.id,
      url: this.getSlicedUrl(worker.url),
    };
  }

  private getSlicedUrl(url: string) {
    if (url.length <= 32) {
      return url;
    }

    return `${url.slice(0, 24)}...${url.slice(-8)}`;
  }

  private createAggressiveTasks(fromBlock: bigint, endBlock: bigint) {
    const tasks: AggressiveTask[] = [];
    let cursor = fromBlock;

    while (cursor <= endBlock) {
      const toBlock =
        cursor + LeaderboardService.BATCH_SIZE < endBlock
          ? cursor + LeaderboardService.BATCH_SIZE
          : endBlock;

      tasks.push({
        fromBlock: cursor,
        toBlock,
        status: 'created',
        attempts: 0,
      });

      cursor = toBlock + 1n;
    }

    return tasks;
  }

  private async runAggressiveTask({
    contract,
    task,
    worker,
    basePenaltyMs,
    maxPenaltyMs,
  }: {
    contract: Contract;
    task: AggressiveTask;
    worker: AggressiveWorker;
    basePenaltyMs: number;
    maxPenaltyMs: number;
  }) {
    task.status = 'processing';
    task.attempts++;
    worker.isBusy = true;

    try {
      const eventLogs = await this.fetchEventLogs({
        contract,
        getLogs: async (address) =>
          await worker.client.getLogs({
            fromBlock: task.fromBlock,
            toBlock: task.toBlock,
            address,
          }),
      });
      const block = await this.getValidBlockFromClient(
        worker.client,
        task.fromBlock,
      );
      const perpTradeEventLogs = eventLogs.filter((log) =>
        getWeb3Info(
          contract.platform,
          contract.version,
        ).tradeEventNames.includes(log.eventLog.eventName),
      );

      await this.handlePerpTradeEventLogs({
        contract,
        block,
        perpTradeEventLogs,
      });

      task.status = 'completed';
      worker.penaltyLevel = Math.max(worker.penaltyLevel - 1, 0);
    } catch (err) {
      task.status = 'failed';
      worker.penaltyLevel += 1;
      worker.availableAt =
        Date.now() +
        Math.min(
          basePenaltyMs * 2 ** Math.max(worker.penaltyLevel - 1, 0),
          maxPenaltyMs,
        );

      this.logger.log({
        severity: 'Error',
        summary: 'leaderboard>startAggressiveAdaption',
        details: `worker:${worker.id} chainId:${contract.id} block:${Number(task.fromBlock)} - ${Number(task.toBlock)} ${getReadableError(err)}`,
      });
    } finally {
      worker.isBusy = false;
    }
  }

  private async fetchEventLogs({
    contract,
    getLogs,
  }: {
    contract: Contract;
    getLogs: (address: Address) => Promise<any[]>;
  }) {
    if (contract.platform === Platform.AVNT) {
      return await this.fetchAvntEventLogs(getLogs);
    }

    const logs = (await getLogs(contract.address as Address)).filter(
      (log) => log.topics.length > 0,
    );

    return logs
      .filter((log) => {
        const info = getWeb3Info(contract.platform, contract.version);

        return info.eventSignatures
          ? info.eventSignatures[log.topics[0] as string]
          : true;
      })
      .map((log) => {
        const decoded: any = decodeEventLog({
          abi: getWeb3Info(contract.platform, contract.version).abi,
          data: log.data,
          topics: log.topics,
        });

        let eventLog = decoded;

        if (contract.platform === Platform.GMX) {
          eventLog = parseEvent(decoded.args.eventName, decoded.args.eventData);
        }

        return {
          eventLog,
          blockNumber: Number(log.blockNumber),
          logIndex: Number(log.logIndex),
          transactionHash: String(log.transactionHash ?? ''),
        };
      });
  }

  private async fetchAvntEventLogs(
    getLogs: (address: Address) => Promise<any[]>,
  ) {
    const tradingCallbackLogs = (
      await getLogs(avntContractAddresses.TradingCallback as `0x${string}`)
    ).filter((log) => log.topics.length > 0);

    await delay(1_000);

    const tradingLogs = (
      await getLogs(avntContractAddresses.Trading as `0x${string}`)
    ).filter((log) => log.topics.length > 0);

    return [...tradingCallbackLogs, ...tradingLogs]
      .map((log) => {
        try {
          return {
            eventLog: decodeEventLog({
              abi: avntGeneralAbi,
              data: log.data,
              topics: log.topics,
            }),
            blockNumber: Number(log.blockNumber),
            logIndex: Number(log.logIndex),
            transactionHash: String(log.transactionHash ?? ''),
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
      });
  }

  private async getValidBlockFromClient(
    publicClient: PublicClient,
    blockNumber: bigint,
  ): Promise<Block> {
    try {
      return await publicClient.getBlock({
        blockNumber,
      });
    } catch (err: any) {
      if (err?.name === 'BlockNotFoundError') {
        return await this.getValidBlockFromClient(
          publicClient,
          blockNumber + 1n,
        );
      }

      throw err;
    }
  }

  private async cleanLogs(
    contractId: number,
    fromBlock: number,
    endBlock: number,
  ) {
    await this.prismaService.perpTradingEventLog.deleteMany({
      where: {
        contractId,
        block: {
          gte: Number(fromBlock),
          lte: Number(endBlock),
        },
      },
    });
  }

  private async handlePerpTradeEventLogs({
    contract,
    block,
    perpTradeEventLogs,
  }: {
    contract: Contract;
    block: Block;
    perpTradeEventLogs: {
      eventLog: any;
      blockNumber: number;
      logIndex: number;
      transactionHash: string;
    }[];
  }) {
    const web3Info = getWeb3Info(contract.platform, contract.version);

    const perpTradingEventInputs: CreatePerpTradingEventLogInput[] =
      perpTradeEventLogs
        .map((log) => {
          const history = web3Info.eventToPerpTradeHistory(
            contract.chainId,
            log.eventLog,
          );

          if (!history) {
            return null;
          }

          return {
            contractId: contract.id,
            platform: contract.platform,
            address: history.address.toLowerCase(),
            jsonLog: this.serializeEventLog(log.eventLog),
            usdPnl: history.usdPnl,
            block: log.blockNumber,
            logIndex: log.logIndex,
            transactionHash: log.transactionHash,
            date: new Date(Number(block.timestamp) * 1000),
          };
        })
        .filter((item): item is CreatePerpTradingEventLogInput => !!item);

    return await this.eventLogsService.createManyPerpTradingEventLogs(
      perpTradingEventInputs,
    );
  }

  private serializeEventLog(eventLog: unknown) {
    return JSON.stringify(eventLog, (_, value) =>
      typeof value === 'bigint' ? value.toString() : value,
    );
  }
}
