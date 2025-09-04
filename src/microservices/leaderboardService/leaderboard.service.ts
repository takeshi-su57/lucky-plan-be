import { Injectable } from '@nestjs/common';
import { Address, Block, decodeEventLog } from 'viem';
import {
  Contract,
  ContractStatus,
  Platform,
  TradeActionType,
  Version,
} from '@prisma/client';

import { eventToActionParser as eventToActionParserV10 } from 'src/web3/platform/gns/v10/eventParsers';
import { eventToActionParser as eventToActionParserV9 } from 'src/web3/platform/gns/v9/eventParsers';

import { positionSizeIncreaseExecutedEventParser as positionSizeIncreaseExecutedV10EventParser } from 'src/web3/platform/gns/v10/eventParsers/position-size-increase-executed.parser';
import { positionSizeDecreaseExecutedEventParser as positionSizeDecreaseExecutedV10EventParser } from 'src/web3/platform/gns/v10/eventParsers/position-size-decrease-executed.parser';
import { leverageUpdateExecutedEventParser as leverageUpdateExecutedV10EventParser } from 'src/web3/platform/gns/v10/eventParsers/leverage-update-executed.parser';
import { marketExecutedEventParser as marketExecutedV10EventParser } from 'src/web3/platform/gns/v10/eventParsers/market-executed.parser';
import { limitExecutedEventParser as limitExecutedV10EventParser } from 'src/web3/platform/gns/v10/eventParsers/limit-executed.parser';

import { positionSizeIncreaseExecutedEventParser as positionSizeIncreaseExecutedV9EventParser } from 'src/web3/platform/gns/v9/eventParsers/position-size-increase-executed.parser';
import { positionSizeDecreaseExecutedEventParser as positionSizeDecreaseExecutedV9EventParser } from 'src/web3/platform/gns/v9/eventParsers/position-size-decrease-executed.parser';
import { leverageUpdateExecutedEventParser as leverageUpdateExecutedV9EventParser } from 'src/web3/platform/gns/v9/eventParsers/leverage-update-executed.parser';
import { marketExecutedEventParser as marketExecutedV9EventParser } from 'src/web3/platform/gns/v9/eventParsers/market-executed.parser';
import { limitExecutedEventParser as limitExecutedV9EventParser } from 'src/web3/platform/gns/v9/eventParsers/limit-executed.parser';

import { delay, getReadableError } from '../../utils';
import { ChainPriority, ServiceStatus } from 'src/types';

import { ContractsService } from '../apiService/modules/contracts/contracts.service';
import { TradeHistoriesService } from '../apiService/modules/trade-histories/trade-histories.service';
import { LogsService } from '../../global/logs.service';
import { EvmAdapterService } from 'src/web3/web3/evm-adapter.service';
import { EventLogsService } from '../apiService/modules/trade-histories/event-logs.service';
import { GnsService } from 'src/web3/platform/gns/gns.service';
import { PrismaService } from 'src/global/prisma.service';
import { CreatePerpTradingEventLogInput } from '../apiService/modules/trade-histories/dto/event-logs.input';
import {
  CancelReason,
  PendingOrderType,
} from '../../web3/platform/gns/v10/types';

import { parseEvent } from '../../web3/platform/gmx/v2/eventParsers';

import { getWeb3Info } from 'src/web3/utils';
import { parseGnsPositionKey } from 'src/web3/platform/gns/utils';

@Injectable()
export class LeaderboardService {
  isReceivedKillProcess = false;
  status: Record<number, ServiceStatus> = {};

  static BATCH_SIZE = 4000n;

  constructor(
    private readonly evmAdapterService: EvmAdapterService,
    private readonly contractsService: ContractsService,
    private readonly tradeHistoriesService: TradeHistoriesService,
    private readonly eventLogsService: EventLogsService,
    private readonly logger: LogsService,
    private readonly gnsService: GnsService,
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
      .map((contract) => this.startAdaption(contract.id, false));

    await Promise.allSettled(promises);
  }

  async startAdaption(contractId: number, shouldRestart: boolean) {
    if (this.status[contractId] === ServiceStatus.PROCESS) {
      return;
    }

    this.status[contractId] = ServiceStatus.PROCESS;

    try {
      const contract = await this.contractsService.findOne(contractId);

      const currentBlockNumber = await this.evmAdapterService.getBlockNumber({
        chainId: contract.chainId,
        priority: ChainPriority.HIGH,
      });

      let fromBlock = shouldRestart
        ? BigInt(contract.fromBlock)
        : BigInt(contract.lastLeaderboardBlockNumber) + 1n;

      const endBlock = contract.toBlock
        ? BigInt(contract.toBlock)
        : currentBlockNumber;

      await this.cleanLogs(
        contract.platform,
        contract.id,
        Number(fromBlock),
        Number(endBlock),
      );

      await this.logger.log({
        severity: 'Info',
        summary: 'leaderboard>startAdaption',
        details: `chainId:${contract.chainId} contractId:${contractId} block:${Number(fromBlock)} - ${Number(endBlock)}`,
      });

      while (fromBlock <= endBlock) {
        const toBlock =
          fromBlock + LeaderboardService.BATCH_SIZE < endBlock
            ? fromBlock + LeaderboardService.BATCH_SIZE
            : endBlock;

        await this.logger.log({
          severity: 'Info',
          summary: 'leaderboard>startAdaption',
          details: `chainId:${contract.chainId} contractId:${contractId} block:${Number(fromBlock)} - ${Number(toBlock)}`,
        });

        if (
          this.isReceivedKillProcess ||
          this.gnsService.status === ServiceStatus.KILLED
        ) {
          await this.logger.log({
            severity: 'Info',
            summary: 'leaderboard>startAdaption',
            details: `killed by gnsService stopped or kill process received`,
          });

          break;
        }

        if (
          this.gnsService.status === ServiceStatus.PAUSED ||
          this.gnsService.status === ServiceStatus.PROCESS
        ) {
          await this.logger.log({
            severity: 'Info',
            summary: 'leaderboard>startAdaption',
            details: `Awaited by gnsService paused`,
          });

          await delay(10_000);
          continue;
        }

        const logs = (
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

        const eventLogs = logs
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
            };
          });

        await this.eventLogsService.createManyEventLogs(
          eventLogs.map((log) => ({
            contractId: contract.id,
            jsonLog: JSON.stringify(log.eventLog, (_, v) =>
              typeof v === 'bigint' ? v.toString() : v,
            ),
            block: log.blockNumber,
            logIndex: log.logIndex,
            date: new Date(Number(block.timestamp) * 1000),
          })),
        );

        const perpTradeEventLogs = eventLogs.filter((log) =>
          getWeb3Info(
            contract.platform,
            contract.version,
          ).tradeEventNames.includes(log.eventLog.eventName),
        );

        if (contract.platform === Platform.GNS) {
          if (contract.version === Version.V9) {
            await this.handleEventLogForGnsV9({
              contract,
              block,
              perpTradeEventLogs,
            });
          }

          if (contract.version === Version.V10) {
            await this.handleEventLogForGnsV10({
              contract,
              block,
              perpTradeEventLogs,
            });
          }
        }

        if (contract.platform === Platform.GMX) {
          if (contract.version === Version.V2) {
            await this.handleEventLogForGmxV2({
              contract,
              block,
              perpTradeEventLogs,
            });
          }
        }

        await this.contractsService.updateLastLeaderboardBlockNumber(
          contract.id,
          Number(toBlock),
        );

        fromBlock = toBlock + 1n;
      }
    } catch (err) {
      await this.logger.log({
        severity: 'Error',
        summary: 'leaderboard>startAdaption',
        details: `contractId:${contractId} ${getReadableError(err)}`,
      });
    }

    await this.logger.log({
      severity: 'Info',
      summary: 'leaderboard>startAdaption',
      details: `finished contractId:${contractId}`,
    });

    this.status[contractId] = ServiceStatus.READY;
  }

  private async cleanLogs(
    platform: Platform,
    contractId: number,
    fromBlock: number,
    endBlock: number,
  ) {
    await this.prismaService.eventLog.deleteMany({
      where: {
        contractId,
        block: {
          gte: Number(fromBlock),
          lte: Number(endBlock),
        },
      },
    });

    await this.prismaService.perpTradingEventLog.deleteMany({
      where: {
        contractId,
        block: {
          gte: Number(fromBlock),
          lte: Number(endBlock),
        },
      },
    });

    if (platform === Platform.GNS) {
      await this.prismaService.tradeHistory.deleteMany({
        where: {
          contractId,
          block: {
            gte: Number(fromBlock),
            lte: Number(endBlock),
          },
        },
      });
    }
  }

  private async handleEventLogForGnsV9({
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
    }[];
  }) {
    const actionItems = perpTradeEventLogs.map((log) => {
      const parsed = eventToActionParserV9(log.eventLog as any);

      return {
        item: parsed,
        blockNumber: log.blockNumber,
        logIndex: log.logIndex,
      };
    });

    const perpTradingEventInputs: CreatePerpTradingEventLogInput[] =
      perpTradeEventLogs.map((log) => {
        let usdPnl = 0;

        const parsed = eventToActionParserV9(log.eventLog as any);

        switch (parsed.name) {
          case positionSizeIncreaseExecutedV9EventParser.eventName: {
            const { args } =
              positionSizeIncreaseExecutedV9EventParser.actionParser(parsed);

            if (args.cancelReason !== CancelReason.NONE) {
              break;
            }

            const collateral = this.gnsService.getCollateral(
              contract.id,
              args.collateralIndex,
            );

            usdPnl =
              -Number(
                Number(args.values.borrowingFeeCollateral) /
                  Number(collateral.precision),
              ) *
              (Number(args.collateralPriceUsd) / 1e8);

            break;
          }
          case positionSizeDecreaseExecutedV9EventParser.eventName: {
            const { args } =
              positionSizeDecreaseExecutedV9EventParser.actionParser(parsed);

            if (args.cancelReason !== CancelReason.NONE) {
              break;
            }

            const collateral = this.gnsService.getCollateral(
              contract.id,
              args.collateralIndex,
            );

            usdPnl =
              Number(
                (Number(args.values.collateralSentToTrader) -
                  Number(args.collateralDelta)) /
                  Number(collateral.precision),
              ) *
              (Number(args.collateralPriceUsd) / 1e8);

            break;
          }
          case leverageUpdateExecutedV9EventParser.eventName: {
            const { args } =
              leverageUpdateExecutedV9EventParser.actionParser(parsed);

            if (args.cancelReason !== CancelReason.NONE) {
              break;
            }

            usdPnl = 0;

            break;
          }
          case marketExecutedV9EventParser.eventName: {
            const { args } = marketExecutedV9EventParser.actionParser(parsed);

            const collateral = this.gnsService.getCollateral(
              contract.id,
              args.t.collateralIndex,
            );

            usdPnl =
              (args.open
                ? 0
                : Number(
                    (Number(args.amountSentToTrader) -
                      Number(args.t.collateralAmount)) /
                      Number(collateral.precision),
                  )) *
              (Number(args.collateralPriceUsd) / 1e8);

            break;
          }
          case limitExecutedV9EventParser.eventName: {
            const { args } = limitExecutedV9EventParser.actionParser(parsed);

            const collateral = this.gnsService.getCollateral(
              contract.id,
              args.t.collateralIndex,
            );

            const actionNameMap: Record<string, string> = {
              [PendingOrderType.LIMIT_OPEN]: TradeActionType.TradeOpenedLimit,
              [PendingOrderType.LIQ_CLOSE]: TradeActionType.TradeClosedLIQ,
              [PendingOrderType.SL_CLOSE]: TradeActionType.TradeClosedSL,
              [PendingOrderType.TP_CLOSE]: TradeActionType.TradeClosedTP,
            };

            if (!actionNameMap[args.orderType]) {
              break;
            }

            usdPnl =
              (args.orderType === PendingOrderType.LIMIT_OPEN
                ? 0
                : Number(
                    (Number(args.amountSentToTrader) -
                      Number(args.t.collateralAmount)) /
                      Number(collateral.precision),
                  )) *
              (Number(args.collateralPriceUsd) / 1e8);

            break;
          }
          default: {
            break;
          }
        }

        const { address } = parseGnsPositionKey(parsed.positionKey);

        return {
          contractId: contract.id,
          platform: contract.platform,
          address: address.toLowerCase(),
          jsonLog: JSON.stringify(log.eventLog, (_, v) =>
            typeof v === 'bigint' ? v.toString() : v,
          ),
          usdPnl,
          block: log.blockNumber,
          logIndex: log.logIndex,
          date: new Date(Number(block.timestamp) * 1000),
        };
      });

    await this.eventLogsService.createManyPerpTradingEventLogs(
      perpTradingEventInputs,
    );

    await this.tradeHistoriesService.handleActionItemsV9(
      contract.id,
      actionItems.map((item) => ({
        item: item.item,
        blockNumber: item.blockNumber,
        timestamp: new Date(Number(block.timestamp) * 1000),
      })),
    );
  }

  private async handleEventLogForGnsV10({
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
    }[];
  }) {
    const actionItems = perpTradeEventLogs.map((log) => {
      const parsed = eventToActionParserV10(log.eventLog as any);

      return {
        item: parsed,
        blockNumber: log.blockNumber,
        logIndex: log.logIndex,
      };
    });

    const perpTradingEventInputs: CreatePerpTradingEventLogInput[] =
      perpTradeEventLogs.map((log) => {
        let usdPnl = 0;

        const parsed = eventToActionParserV10(log.eventLog as any);

        switch (parsed.name) {
          case positionSizeIncreaseExecutedV10EventParser.eventName: {
            const { args } =
              positionSizeIncreaseExecutedV9EventParser.actionParser(parsed);

            if (args.cancelReason !== CancelReason.NONE) {
              break;
            }

            const collateral = this.gnsService.getCollateral(
              contract.id,
              args.collateralIndex,
            );

            usdPnl =
              Number(
                Number(args.values.openingFeesCollateral) /
                  Number(collateral.precision),
              ) *
              (Number(args.collateralPriceUsd) / 1e8);

            break;
          }
          case positionSizeDecreaseExecutedV10EventParser.eventName: {
            const { args } =
              positionSizeDecreaseExecutedV10EventParser.actionParser(parsed);

            if (args.cancelReason !== CancelReason.NONE) {
              break;
            }

            const collateral = this.gnsService.getCollateral(
              contract.id,
              args.collateralIndex,
            );

            usdPnl =
              Number(
                (Number(args.values.partialNetPnlCollateral) -
                  Number(args.values.closingFeeCollateral)) /
                  Number(collateral.precision),
              ) *
              (Number(args.collateralPriceUsd) / 1e8);

            break;
          }
          case leverageUpdateExecutedV10EventParser.eventName: {
            const { args } =
              leverageUpdateExecutedV10EventParser.actionParser(parsed);

            if (args.cancelReason !== CancelReason.NONE) {
              break;
            }

            usdPnl = 0;

            break;
          }
          case marketExecutedV10EventParser.eventName: {
            const { args } = marketExecutedV10EventParser.actionParser(parsed);

            const collateral = this.gnsService.getCollateral(
              contract.id,
              args.t.collateralIndex,
            );

            usdPnl =
              (args.open
                ? 0
                : Number(
                    (Number(args.amountSentToTrader) -
                      Number(args.t.collateralAmount)) /
                      Number(collateral.precision),
                  )) *
              (Number(args.collateralPriceUsd) / 1e8);

            break;
          }
          case limitExecutedV10EventParser.eventName: {
            const { args } = limitExecutedV10EventParser.actionParser(parsed);

            const collateral = this.gnsService.getCollateral(
              contract.id,
              args.t.collateralIndex,
            );

            const actionNameMap: Record<string, string> = {
              [PendingOrderType.LIMIT_OPEN]: TradeActionType.TradeOpenedLimit,
              [PendingOrderType.LIQ_CLOSE]: TradeActionType.TradeClosedLIQ,
              [PendingOrderType.SL_CLOSE]: TradeActionType.TradeClosedSL,
              [PendingOrderType.TP_CLOSE]: TradeActionType.TradeClosedTP,
            };

            if (!actionNameMap[args.orderType]) {
              break;
            }

            usdPnl =
              (args.orderType === PendingOrderType.LIMIT_OPEN
                ? 0
                : Number(
                    (Number(args.amountSentToTrader) -
                      Number(args.t.collateralAmount)) /
                      Number(collateral.precision),
                  )) *
              (Number(args.collateralPriceUsd) / 1e8);

            break;
          }
          default: {
            break;
          }
        }

        const { address } = parseGnsPositionKey(parsed.positionKey);

        return {
          contractId: contract.id,
          platform: contract.platform,
          address: address.toLowerCase(),
          jsonLog: JSON.stringify(log.eventLog, (_, v) =>
            typeof v === 'bigint' ? v.toString() : v,
          ),
          usdPnl,
          block: log.blockNumber,
          logIndex: log.logIndex,
          date: new Date(Number(block.timestamp) * 1000),
        };
      });

    await this.eventLogsService.createManyPerpTradingEventLogs(
      perpTradingEventInputs,
    );

    await this.tradeHistoriesService.handleActionItems(
      contract.id,
      actionItems.map((item) => ({
        item: item.item,
        blockNumber: item.blockNumber,
        timestamp: new Date(Number(block.timestamp) * 1000),
      })),
    );
  }

  private async handleEventLogForGmxV2({
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
    }[];
  }) {
    const perpTradingEventInputs: CreatePerpTradingEventLogInput[] =
      perpTradeEventLogs.map((log) => {
        let usdPnl = 0;

        switch (log.eventLog.eventName) {
          case 'PositionIncrease': {
            usdPnl =
              Number(
                log.eventLog.args.priceImpactUsd?.toString() ||
                  log.eventLog.args.pendingPriceImpactUsd?.toString() ||
                  '0',
              ) / 1e30;
            break;
          }
          case 'PositionDecrease': {
            usdPnl =
              Number(log.eventLog.args.basePnlUsd?.toString() || '0') / 1e30 +
              Number(
                log.eventLog.args.totalImpactUsd?.toString() ||
                  log.eventLog.args.priceImpactUsd?.toString() ||
                  '0',
              ) /
                1e30;
            break;
          }
          default: {
            break;
          }
        }

        return {
          contractId: contract.id,
          platform: contract.platform,
          address: log.eventLog.args.account.toLowerCase(),
          jsonLog: JSON.stringify(log.eventLog, (_, v) =>
            typeof v === 'bigint' ? v.toString() : v,
          ),
          usdPnl,
          block: log.blockNumber,
          logIndex: log.logIndex,
          date: new Date(Number(block.timestamp) * 1000),
        };
      });

    await this.eventLogsService.createManyPerpTradingEventLogs(
      perpTradingEventInputs,
    );
  }
}
