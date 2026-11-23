import { Injectable } from '@nestjs/common';
import { AbiEvent, Address, Block, decodeEventLog, PublicClient } from 'viem';
import {
  Contract,
  ContractStatus,
  Platform,
  Version,
} from 'generated/prisma/client';

import { getReadableError } from 'src/utils';
import { ChainPriority, ServiceStatus } from 'src/types';

import { ContractsService } from 'src/microservices/apiService/modules/contracts/contracts.service';
import { LogsService } from 'src/global/logs.service';
import { EvmAdapterService } from 'src/web3/web3/evm-adapter.service';
import { EventLogsService } from 'src/microservices/apiService/modules/trade-histories/event-logs.service';
import { PrismaService } from 'src/global/prisma.service';
import { CreatePerpTradingEventLogInput } from 'src/microservices/apiService/modules/trade-histories/dto/event-logs.input';
import { contractAddresses as avntContractAddresses } from 'src/web3/platform/avnt/v1/configs';

import { parseEvent } from 'src/web3/platform/gmx/v2/eventParsers';

import { getWeb3Info } from 'src/web3/utils';
import { delay } from 'src/utils';

import { avntGeneralAbi } from 'src/web3/platform/avnt/v1/abi/AvntGeneral';
import { assertGmxV1BackfillReady } from 'src/web3/platform/gmx/v1/configs/backfill-preflight';

import {
  AggressiveRangeQueue,
  AggressiveRangeQueueSnapshot,
  BlockRange,
} from './aggressive-range-queue';
import { classifyRpcError } from './rpc-error-classifier';
import {
  PenaltyOptions,
  RpcPoolWorker,
  RpcWorkerPoolService,
} from './rpc-worker-pool.service';

type AggressiveAdaptionOptions = {
  basePenaltyMs?: number;
  maxPenaltyMs?: number;
};

export type AggressiveAdaptionView = AggressiveRangeQueueSnapshot & {
  contractId: number;
  chainId: number;
  startedAt: number;
};

type AggressiveRun = {
  contract: Contract;
  queue: AggressiveRangeQueue;
  startedAt: number;
};

/** Marks errors thrown by the RPC so DB failures don't penalize workers. */
class RpcCallError extends Error {
  constructor(readonly original: unknown) {
    super(getReadableError(original));
  }
}

@Injectable()
export class LeaderboardService {
  isReceivedKillProcess = false;
  status: Record<number, ServiceStatus> = {};

  /** Largest block span per getLogs call; workers may be limited further. */
  static BATCH_SIZE = 4000n;

  private readonly aggressiveRuns = new Map<number, AggressiveRun>();
  private readonly tradeLogEventsCache = new Map<
    string,
    readonly AbiEvent[] | null
  >();

  constructor(
    private readonly evmAdapterService: EvmAdapterService,
    private readonly contractsService: ContractsService,
    private readonly eventLogsService: EventLogsService,
    private readonly logger: LogsService,
    private readonly prismaService: PrismaService,
    private readonly rpcWorkerPool: RpcWorkerPoolService,
  ) {
    this.isReceivedKillProcess = false;
  }

  getAllStatus() {
    return this.status;
  }

  getAggressiveAdaptions(): AggressiveAdaptionView[] {
    return Array.from(this.aggressiveRuns.values()).map((run) => ({
      contractId: run.contract.id,
      chainId: run.contract.chainId,
      startedAt: run.startedAt,
      ...run.queue.snapshot(),
    }));
  }

  getRpcWorkers() {
    return {
      workers: this.rpcWorkerPool.snapshot(),
      adaptions: this.getAggressiveAdaptions(),
      rateGroups: this.rpcWorkerPool.rateGroups(),
      settings: this.rpcWorkerPool.backfillSettings(),
    };
  }

  async reloadRpcWorkers() {
    await this.rpcWorkerPool.reloadAll();
    return true;
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
      assertGmxV1BackfillReady(contract);

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
          getLogs: async (address, events) =>
            await this.evmAdapterService.getLogs({
              chainId: contract.chainId,
              priority: ChainPriority.HIGH,
              address,
              fromBlock,
              toBlock,
              events,
            }),
        });

        const perpTradeEventLogs = eventLogs.filter((log) =>
          getWeb3Info(
            contract.platform,
            contract.version,
          ).tradeEventNames.includes(log.eventLog.eventName),
        );

        await this.handlePerpTradeEventLogs({
          contract,
          fromBlock,
          toBlock,
          getBlock: async (blockNumber) =>
            await this.evmAdapterService.getBlock({
              chainId: contract.chainId,
              priority: ChainPriority.HIGH,
              blockNumber,
            }),
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
      assertGmxV1BackfillReady(contract);
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

      await this.rpcWorkerPool.ensureChain(contract.chainId);
      const workers = this.rpcWorkerPool.getWorkers(contract.chainId);

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
        penalty: {
          basePenaltyMs: options.basePenaltyMs ?? 2_100,
          maxPenaltyMs: options.maxPenaltyMs ?? 5 * 60_000,
        },
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
    penalty,
  }: {
    contract: Contract;
    fromBlock: bigint;
    endBlock: bigint;
    penalty: PenaltyOptions;
  }) {
    const queue = new AggressiveRangeQueue(
      fromBlock,
      endBlock,
      LeaderboardService.BATCH_SIZE,
    );
    const run: AggressiveRun = { contract, queue, startedAt: Date.now() };
    this.aggressiveRuns.set(contract.id, run);

    // Checkpoint writes are chained so they land in order.
    let checkpointWrite: Promise<unknown> = Promise.resolve();

    try {
      await new Promise<void>((resolve) => {
        let finished = false;

        const finish = () => {
          if (finished) return;
          finished = true;
          clearInterval(tick);
          clearInterval(reportInterval);
          resolve();
        };

        const onComplete = (range: BlockRange) => {
          const checkpoint = queue.complete(range);

          if (checkpoint === null) return;

          checkpointWrite = checkpointWrite
            .then(() =>
              this.contractsService.updateLastLeaderboardBlockNumber(
                contract.id,
                Number(checkpoint),
              ),
            )
            .then(() =>
              this.logger.log({
                severity: 'Info',
                summary: 'leaderboard>startAggressiveAdaption',
                details: `chainId:${contract.chainId} contractId:${contract.id} checkpoint:${Number(checkpoint)}`,
              }),
            )
            .catch((err) =>
              this.logger.log({
                severity: 'Error',
                summary: 'leaderboard>startAggressiveAdaption',
                details: `contractId:${contract.id} checkpoint write failed ${getReadableError(err)}`,
              }),
            );
        };

        const schedule = () => {
          if (finished) return;

          if (this.isReceivedKillProcess || queue.isDone()) {
            finish();
            return;
          }

          const now = Date.now();

          for (const worker of this.rpcWorkerPool.getWorkers(
            contract.chainId,
          )) {
            if (!queue.hasClaimable()) break;
            if (!this.rpcWorkerPool.isAvailable(worker, now)) continue;

            const range = queue.claim(
              worker.maxBlockRange ? BigInt(worker.maxBlockRange) : null,
            );

            if (!range) break;

            this.rpcWorkerPool.acquire(worker, {
              contractId: contract.id,
              fromBlock: range.fromBlock,
              toBlock: range.toBlock,
              startedAt: now,
            });

            this.runAggressiveTask({ contract, range, worker, queue, penalty })
              .then((ok) => ok && onComplete(range))
              .finally(schedule);
          }
        };

        // Wakes the loop for penalty expiry, resumed or newly added workers.
        const tick = setInterval(schedule, 250);
        const reportInterval = setInterval(() => {
          this.reportAggressiveAdaptionTasks(contract, queue);
        }, 60_000);

        schedule();
      });

      await checkpointWrite;
    } finally {
      if (this.aggressiveRuns.get(contract.id) === run) {
        this.aggressiveRuns.delete(contract.id);
      }
    }
  }

  private reportAggressiveAdaptionTasks(
    contract: Contract,
    queue: AggressiveRangeQueue,
  ) {
    const now = Date.now();
    const workers = this.rpcWorkerPool.getWorkers(contract.chainId);
    const report = {
      contractId: contract.id,
      chainId: contract.chainId,
      ...queue.snapshot(),
      workingWorkers: workers.filter((worker) => worker.assignment).length,
      availableWorkers: workers.filter((worker) =>
        this.rpcWorkerPool.isAvailable(worker, now),
      ).length,
      penaltyWorkers: workers.filter(
        (worker) =>
          worker.state === 'Active' &&
          !worker.assignment &&
          worker.availableAt > now,
      ).length,
      pausedWorkers: workers.filter((worker) => worker.state === 'Paused')
        .length,
      disabledWorkers: workers.filter((worker) => worker.state === 'Disabled')
        .length,
    };

    this.logger.log({
      severity: 'Info',
      summary: 'leaderboard>aggressiveAdaptionReport',
      details: JSON.stringify(report, null, 2),
    });
  }

  /** Runs one range on one worker. Resolves true when the range is done. */
  private async runAggressiveTask({
    contract,
    range,
    worker,
    queue,
    penalty,
  }: {
    contract: Contract;
    range: BlockRange;
    worker: RpcPoolWorker;
    queue: AggressiveRangeQueue;
    penalty: PenaltyOptions;
  }): Promise<boolean> {
    const rpc = async <T>(call: () => Promise<T>) => {
      try {
        return await call();
      } catch (err) {
        throw new RpcCallError(err);
      }
    };
    const rangeBlocks = Number(range.toBlock - range.fromBlock + 1n);

    try {
      const eventLogs = await this.fetchEventLogs({
        contract,
        getLogs: async (address, events) =>
          await rpc(() =>
            worker.client.getLogs({
              fromBlock: range.fromBlock,
              toBlock: range.toBlock,
              address,
              events: events as readonly AbiEvent[] | undefined,
            }),
          ),
      });
      const perpTradeEventLogs = eventLogs.filter((log) =>
        getWeb3Info(
          contract.platform,
          contract.version,
        ).tradeEventNames.includes(log.eventLog.eventName),
      );

      await this.handlePerpTradeEventLogs({
        contract,
        fromBlock: range.fromBlock,
        toBlock: range.toBlock,
        getBlock: async (blockNumber) =>
          await rpc(() =>
            this.getValidBlockFromClient(worker.client, blockNumber),
          ),
        perpTradeEventLogs,
      });

      this.rpcWorkerPool.markSuccess(worker, rangeBlocks);
      return true;
    } catch (err) {
      if (!(err instanceof RpcCallError)) {
        // Decoding or DB failure: not the endpoint's fault.
        this.rpcWorkerPool.releaseWithoutPenalty(worker);
        queue.release(range, { split: false });

        this.logger.log({
          severity: 'Error',
          summary: 'leaderboard>startAggressiveAdaption',
          details: `worker:${worker.key} contractId:${contract.id} block:${Number(range.fromBlock)} - ${Number(range.toBlock)} non-rpc failure ${getReadableError(err)}`,
        });
        return false;
      }

      const classified = classifyRpcError(err.original);
      await this.rpcWorkerPool.markFailure(
        worker,
        classified,
        rangeBlocks,
        penalty,
      );
      queue.release(range, {
        split: classified.kind === 'response_too_large',
      });

      this.logger.log({
        severity: 'Error',
        summary: 'leaderboard>startAggressiveAdaption',
        details: `worker:${worker.key} chainId:${contract.chainId} contractId:${contract.id} block:${Number(range.fromBlock)} - ${Number(range.toBlock)} kind:${classified.kind} status:${classified.status ?? '-'} ${classified.message}`,
      });
      return false;
    }
  }

  private async fetchEventLogs({
    contract,
    getLogs,
  }: {
    contract: Contract;
    getLogs: (
      address: Address,
      events?: readonly AbiEvent[] | readonly unknown[],
    ) => Promise<any[]>;
  }) {
    if (contract.platform === Platform.AVNT) {
      return await this.fetchAvntEventLogs(getLogs);
    }

    const info = getWeb3Info(contract.platform, contract.version);
    const events = info.logEvents ?? this.getTradeLogEvents(contract);
    const rawLogs = events
      ? await getLogs(contract.address as Address, events)
      : await getLogs(contract.address as Address);
    const logs = rawLogs.filter((log) => log.topics.length > 0);

    const decodedLogs = logs
      .filter((log) =>
        info.eventSignatures
          ? info.eventSignatures[log.topics[0] as string]
          : true,
      )
      .map((log) => {
        const decoded: any = decodeEventLog({
          abi: info.abi,
          data: log.data,
          topics: log.topics,
        });

        let eventLog = decoded;

        if (
          contract.platform === Platform.GMX &&
          contract.version === Version.V2
        ) {
          eventLog = parseEvent(decoded.args.eventName, decoded.args.eventData);
        }

        return {
          eventLog,
          blockNumber: Number(log.blockNumber),
          logIndex: Number(log.logIndex),
          transactionHash: String(log.transactionHash ?? ''),
        };
      });

    return info.normalizeEventLogs
      ? info.normalizeEventLogs(decodedLogs)
      : decodedLogs;
  }

  /**
   * GNS diamonds emit many non-trade events (fees, prices, ...). Filtering by
   * trade-event topics on the RPC side keeps responses well under provider
   * size limits. Only trade events are used downstream anyway.
   */
  private getTradeLogEvents(contract: Contract): readonly AbiEvent[] | null {
    if (contract.platform !== Platform.GNS) {
      return null;
    }

    const cacheKey = `${contract.platform}:${contract.version}`;

    if (this.tradeLogEventsCache.has(cacheKey)) {
      return this.tradeLogEventsCache.get(cacheKey)!;
    }

    const info = getWeb3Info(contract.platform, contract.version);
    const events = (
      info.abi as readonly { type: string; name?: string }[]
    ).filter(
      (item) =>
        item.type === 'event' &&
        !!item.name &&
        info.tradeEventNames.includes(item.name),
    ) as unknown as AbiEvent[];

    const result = events.length > 0 ? events : null;
    this.tradeLogEventsCache.set(cacheKey, result);
    return result;
  }

  private async fetchAvntEventLogs(
    getLogs: (
      address: Address,
      events?: readonly AbiEvent[] | readonly unknown[],
    ) => Promise<any[]>,
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
    fromBlock,
    toBlock,
    getBlock,
    perpTradeEventLogs,
  }: {
    contract: Contract;
    fromBlock: bigint;
    toBlock: bigint;
    getBlock: (blockNumber: bigint) => Promise<Block>;
    perpTradeEventLogs: {
      eventLog: any;
      blockNumber: number;
      logIndex: number;
      transactionHash: string;
    }[];
  }) {
    const web3Info = getWeb3Info(contract.platform, contract.version);

    if (perpTradeEventLogs.length === 0) {
      return await this.eventLogsService.createManyPerpTradingEventLogs([]);
    }

    const getDateForBlock = await this.getDateForBlockInRange(
      fromBlock,
      toBlock,
      getBlock,
    );

    const perpTradingEventInputs: CreatePerpTradingEventLogInput[] =
      perpTradeEventLogs
        .map((log) => {
          const history = web3Info.eventToPerpTradeHistory(
            contract.chainId,
            log.eventLog,
            contract.address,
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
            date: getDateForBlock(log.blockNumber),
          };
        })
        .filter((item): item is CreatePerpTradingEventLogInput => !!item);

    return await this.eventLogsService.createManyPerpTradingEventLogs(
      perpTradingEventInputs,
    );
  }

  private async getDateForBlockInRange(
    fromBlock: bigint,
    toBlock: bigint,
    getBlock: (blockNumber: bigint) => Promise<Block>,
  ): Promise<(blockNumber: number) => Date> {
    const [firstBlock, lastBlock] = await Promise.all([
      getBlock(fromBlock),
      fromBlock === toBlock ? Promise.resolve(null) : getBlock(toBlock),
    ]);
    const firstTimestamp = Number(firstBlock.timestamp);
    const lastTimestamp = Number(lastBlock?.timestamp ?? firstBlock.timestamp);
    const blockSpan = Number(toBlock - fromBlock);
    const timestampSpan = lastTimestamp - firstTimestamp;

    return (blockNumber: number) => {
      const blockOffset = Number(BigInt(blockNumber) - fromBlock);
      const timestamp =
        blockSpan === 0
          ? firstTimestamp
          : firstTimestamp + (blockOffset / blockSpan) * timestampSpan;

      return new Date(Math.round(timestamp * 1000));
    };
  }

  private serializeEventLog(eventLog: unknown) {
    return JSON.stringify(eventLog, (_, value) =>
      typeof value === 'bigint' ? value.toString() : value,
    );
  }
}
