import { Injectable } from '@nestjs/common';
import { Address, Block, decodeEventLog } from 'viem';
import {
  Contract,
  ContractStatus,
  Platform,
  TradeActionType,
  Version,
} from 'generated/prisma/client';

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

import { marketExecutedEventParser as avntMarketExecutedV1EventParser } from 'src/web3/platform/avnt/v1/eventParsers/market-executed.parser';
import { limitExecutedEventParser as avntLimitExecutedV1EventParser } from 'src/web3/platform/avnt/v1/eventParsers/limit-executed.parser';
import { marginUpdateExecutedEventParser as avntMarginUpdateExecutedV1EventParser } from 'src/web3/platform/avnt/v1/eventParsers/margin-update-executed.parser';
import { eventToActionParser as eventToActionParserForAVNT } from 'src/web3/platform/avnt/v1/eventParsers';

import { getReadableError } from 'src/utils';
import { ChainPriority, ServiceStatus } from 'src/types';

import { ContractsService } from 'src/microservices/apiService/modules/contracts/contracts.service';
import { LogsService } from 'src/global/logs.service';
import { EvmAdapterService } from 'src/web3/web3/evm-adapter.service';
import { EventLogsService } from 'src/microservices/apiService/modules/trade-histories/event-logs.service';
import { PrismaService } from 'src/global/prisma.service';
import { CreatePerpTradingEventLogInput } from 'src/microservices/apiService/modules/trade-histories/dto/event-logs.input';
import {
  CancelReason,
  PendingOrderType,
} from 'src/web3/platform/gns/v10/types';
import { contractAddresses as avntContractAddresses } from 'src/web3/platform/avnt/v1/configs';
import { LimitOrder } from 'src/web3/platform/avnt/v1/types';

import { parseEvent } from 'src/web3/platform/gmx/v2/eventParsers';

import { getWeb3Info } from 'src/web3/utils';
import { parseGnsPositionKey } from 'src/web3/platform/gns/utils';
import { getCollateral as getCollateralV9 } from 'src/web3/platform/gns/v9/configs';
import { getCollateral as getCollateralV10 } from 'src/web3/platform/gns/v10/configs';
import { parseAvntPositionKey } from 'src/web3/platform/avnt/utils';
import { delay } from 'src/utils';

import { avntGeneralAbi } from 'src/web3/platform/avnt/v1/abi/AvntGeneral';

@Injectable()
export class LeaderboardService {
  isReceivedKillProcess = false;
  status: Record<number, ServiceStatus> = {};

  static BATCH_SIZE = 4000n;

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

      await this.cleanLogs(contract.id, Number(fromBlock), Number(endBlock));

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

        const perpEntities = [];

        if (contract.platform === Platform.GNS) {
          if (contract.version === Version.V9) {
            perpEntities.push(
              ...(await this.handleEventLogForGnsV9({
                contract,
                block,
                perpTradeEventLogs,
              })),
            );
          }

          if (contract.version === Version.V10) {
            perpEntities.push(
              ...(await this.handleEventLogForGnsV10({
                contract,
                block,
                perpTradeEventLogs,
              })),
            );
          }
        }

        if (contract.platform === Platform.GMX) {
          if (contract.version === Version.V2) {
            perpEntities.push(
              ...(await this.handleEventLogForGmxV2({
                contract,
                block,
                perpTradeEventLogs,
              })),
            );
          }
        }

        if (contract.platform === Platform.AVNT) {
          if (contract.version === Version.V1) {
            perpEntities.push(
              ...(await this.handleEventLogForAvntV1({
                contract,
                block,
                perpTradeEventLogs,
              })),
            );
          }
        }

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

            const collateral = getCollateralV9(
              contract.chainId,
              args.collateralIndex,
            )!;

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

            const collateral = getCollateralV9(
              contract.chainId,
              args.collateralIndex,
            )!;

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

            const collateral = getCollateralV9(
              contract.chainId,
              args.t.collateralIndex,
            )!;

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

            const collateral = getCollateralV9(
              contract.chainId,
              args.t.collateralIndex,
            )!;

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

    return await this.eventLogsService.createManyPerpTradingEventLogs(
      perpTradingEventInputs,
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
    const perpTradingEventInputs: CreatePerpTradingEventLogInput[] =
      perpTradeEventLogs
        .map((log) => {
          let usdPnl = 0;

          const parsed = eventToActionParserV10(log.eventLog as any);

          switch (parsed.name) {
            case positionSizeIncreaseExecutedV10EventParser.eventName: {
              const { args } =
                positionSizeIncreaseExecutedV9EventParser.actionParser(parsed);

              if (args.cancelReason !== CancelReason.NONE) {
                break;
              }

              const collateral = getCollateralV10(
                contract.chainId,
                args.collateralIndex,
              );

              if (!collateral) {
                this.logger.log({
                  severity: 'Notice',
                  summary: 'New Collateral is detected',
                  details: `${contract.chainId} chain on ${log.blockNumber} block`,
                });

                return null;
              }

              usdPnl = 0;

              break;
            }
            case positionSizeDecreaseExecutedV10EventParser.eventName: {
              const { args } =
                positionSizeDecreaseExecutedV10EventParser.actionParser(parsed);

              if (args.cancelReason !== CancelReason.NONE) {
                break;
              }

              const collateral = getCollateralV10(
                contract.chainId,
                args.collateralIndex,
              );

              if (!collateral) {
                this.logger.log({
                  severity: 'Notice',
                  summary: 'New Collateral is detected',
                  details: `${contract.chainId} chain on ${log.blockNumber} block`,
                });

                return null;
              }

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
              const { args } =
                marketExecutedV10EventParser.actionParser(parsed);

              const collateral = getCollateralV10(
                contract.chainId,
                args.t.collateralIndex,
              );

              if (!collateral) {
                this.logger.log({
                  severity: 'Notice',
                  summary: 'New Collateral is detected',
                  details: `${contract.chainId} chain on ${log.blockNumber} block`,
                });

                return null;
              }

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

              const collateral = getCollateralV10(
                contract.chainId,
                args.t.collateralIndex,
              );

              if (!collateral) {
                this.logger.log({
                  severity: 'Notice',
                  summary: 'New Collateral is detected',
                  details: `${contract.chainId} chain on ${log.blockNumber} block`,
                });

                return null;
              }

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
        })
        .filter((item) => item !== null);

    return await this.eventLogsService.createManyPerpTradingEventLogs(
      perpTradingEventInputs,
    );
  }

  private async handleEventLogForAvntV1({
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
      perpTradeEventLogs
        .map((log) => {
          let usdPnl = 0;

          const parsed = eventToActionParserForAVNT(log.eventLog as any);

          switch (parsed.name) {
            case avntMarginUpdateExecutedV1EventParser.eventName: {
              const { args } =
                avntMarginUpdateExecutedV1EventParser.actionParser(parsed);

              usdPnl = Number(args.marginFees) / 1e6;

              break;
            }
            case avntMarketExecutedV1EventParser.eventName: {
              const { args } =
                avntMarketExecutedV1EventParser.actionParser(parsed);

              usdPnl = args.open
                ? 0
                : (Number(args.usdcSentToTrader) -
                    Number(args.positionSizeUSDC)) /
                  1e6;

              break;
            }
            case avntLimitExecutedV1EventParser.eventName: {
              const { args } =
                avntLimitExecutedV1EventParser.actionParser(parsed);

              usdPnl =
                args.orderType === LimitOrder.OPEN
                  ? 0
                  : (Number(args.usdcSentToTrader) -
                      Number(args.positionSizeUSDC)) /
                    1e6;

              break;
            }
            default: {
              break;
            }
          }

          const { address } = parseAvntPositionKey(parsed.positionKey);

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
        })
        .filter((item) => item !== null);

    return await this.eventLogsService.createManyPerpTradingEventLogs(
      perpTradingEventInputs,
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

    return await this.eventLogsService.createManyPerpTradingEventLogs(
      perpTradingEventInputs,
    );
  }
}
