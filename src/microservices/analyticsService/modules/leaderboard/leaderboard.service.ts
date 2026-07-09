import { Injectable } from '@nestjs/common';
import { Address, Block, decodeEventLog } from 'viem';
import { Contract, ContractStatus, Platform } from 'generated/prisma/client';

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

@Injectable()
export class LeaderboardService {
  isReceivedKillProcess = false;
  status: Record<number, ServiceStatus> = {};

  static BATCH_SIZE = 2000n;

  constructor(
    private readonly evmAdapterService: EvmAdapterService,
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

  async startAdaption(contractId: number, shouldRestart: boolean) {
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

        const logs =
          contract.platform === Platform.AVNT
            ? []
            : (
                await this.evmAdapterService.getLogs({
                  chainId: contract.chainId,
                  priority: ChainPriority.HIGH,
                  address: contract.address as Address,
                  fromBlock,
                  toBlock,
                })
              ).filter((log) => log.topics.length > 0);

        const block = await this.evmAdapterService.getValidBlock({
          chainId: contract.chainId,
          priority: ChainPriority.HIGH,
          blockNumber: fromBlock,
        });

        let eventLogs = logs
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
              eventLog = parseEvent(
                decoded.args.eventName,
                decoded.args.eventData,
              );
            }

            return {
              eventLog,
              blockNumber: Number(log.blockNumber),
              logIndex: Number(log.logIndex),
              transactionHash: String(log.transactionHash ?? ''),
            };
          });

        if (contract.platform === Platform.AVNT) {
          const additionalLogs1 = (
            await this.evmAdapterService.getLogs({
              chainId: contract.chainId,
              priority: ChainPriority.HIGH,
              address: avntContractAddresses.TradingCallback as `0x${string}`,
              fromBlock,
              toBlock,
            })
          ).filter((log) => log.topics.length > 0);

          await delay(1_000);

          const additionalLogs2 = (
            await this.evmAdapterService.getLogs({
              chainId: contract.chainId,
              priority: ChainPriority.HIGH,
              address: avntContractAddresses.Trading as `0x${string}`,
              fromBlock,
              toBlock,
            })
          ).filter((log) => log.topics.length > 0);

          const additionalEventLogs = [...additionalLogs1, ...additionalLogs2]
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
            .filter((item) => !!item);

          eventLogs = [...eventLogs, ...additionalEventLogs].sort((a, b) => {
            if (a.blockNumber === b.blockNumber) {
              return a.logIndex - b.logIndex;
            } else {
              return a.blockNumber - b.blockNumber;
            }
          });
        }

        const eventNamesMap: Record<string, number> = {};

        eventLogs.forEach((log) => {
          eventNamesMap[log.eventLog.eventName] =
            (eventNamesMap[log.eventLog.eventName] || 0) + 1;
        });

        this.logger.log({
          severity: 'Info',
          summary: 'leaderboard>startAdaption',
          details: `chainId:${contract.chainId} contractId:${contractId} block:${Number(fromBlock)} - ${Number(toBlock)} - ${JSON.stringify(eventNamesMap, null, 2)}`,
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
