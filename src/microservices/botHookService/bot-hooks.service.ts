import { Injectable } from '@nestjs/common';
import { Address } from 'viem';
import { Contract, ContractStatus, Follower, Platform } from '@prisma/client';
import {
  arbitrum,
  arbitrumSepolia,
  base,
  polygon,
  apeChain,
  Chain,
  avalanche,
} from 'viem/chains';

import { ContractsService } from '../apiService/modules/contracts/contracts.service';
import { getReadableError } from 'src/utils';
import { LogsService } from 'src/global/logs.service';

import { getWeb3Info } from 'src/web3/utils';

import { GnsService } from 'src/web3/platform/gns/gns.service';
import { PrismaService } from 'src/global/prisma.service';
import {
  MarketExecutedEvent,
  MarketExecutedEventArgs,
  marketExecutedEventParser,
} from 'src/web3/platform/gns/v10/eventParsers/market-executed.parser';
import {
  LimitExecutedEvent,
  LimitExecutedEventArgs,
  limitExecutedEventParser,
} from 'src/web3/platform/gns/v10/eventParsers/limit-executed.parser';
import { getCollateral, getPair } from 'src/web3/platform/gns/v10/configs';
import { FollowerService } from '../apiService/modules/follower/follower.service';
import { TradeType, PendingOrderType } from 'src/web3/platform/gns/v10/types';
import { ChainPriority, ServiceStatus, TradeEvent } from 'src/types';
import { USDCCollateralIndex } from 'src/utils/constants';
import { EvmAdapterService } from 'src/web3/web3/evm-adapter.service';
import { ActionItem } from '../apiService/modules/actions/entities/action.entity';

const botAddress = '0xda227b42ffde9d3e4b209ee0e789a374f075e782';

@Injectable()
export class BotHooksService {
  readonly availableChains: Chain[];
  private lastBlockNumbers: Record<number, number> = {};
  private vaultConfigs: Record<
    number,
    { follower: Follower; positionIndex?: number }
  > = {};
  private mnemonic: string;
  private followerContract: Contract;
  public isRunning: boolean = false;
  public status: ServiceStatus;

  constructor(
    private contractsService: ContractsService,
    private gnsService: GnsService,
    private prismaService: PrismaService,
    private followerService: FollowerService,
    private readonly logger: LogsService,
  ) {
    this.availableChains = [
      arbitrum,
      polygon,
      base,
      arbitrumSepolia,
      apeChain,
      avalanche,
    ];

    this.init();
  }

  async hasRisky() {
    try {
      const testContracts = await this.prismaService.contract.findMany();

      const testContractIds: number[] = [];

      const contractsMap = new Map<number, Contract>();

      for (const contract of testContracts) {
        if (contract.isTestnet) {
          testContractIds.push(contract.id);
        } else {
          contractsMap.set(contract.id, contract);
        }
      }

      const perpLogs = await this.prismaService.perpTradingEventLog.findMany({
        where: {
          address: botAddress.toLowerCase(),
          platform: Platform.GNS,
          contractId: {
            notIn: testContractIds,
          },
        },
      });

      const perpHistories = perpLogs
        .map((item) => {
          const contract = contractsMap.get(item.contractId);

          if (!contract) {
            return null;
          }

          const web3Info = getWeb3Info(contract.platform, contract.version);

          const history = web3Info.eventToPerpTradeHistory(
            contract.chainId,
            JSON.parse(item.jsonLog) as any,
          );

          return history;
        })
        .filter((item) => item !== null);

      const negativePnlHistories = perpHistories.filter(
        (item) => item.usdPnl < -10,
      );

      this.logger.log({
        severity: 'Debug',
        summary: 'trading>bot-hook>hasRisky',
        details: `negativePnlHistories.length: ${negativePnlHistories.length}`,
      });

      return negativePnlHistories.length > 10;
    } catch (err) {
      this.logger.log({
        severity: 'Error',
        summary: 'trading>bot-hook>hasRisky',
        details: getReadableError(err),
      });
    }

    return true;
  }

  async init() {
    try {
      const user = await this.prismaService.user.findUnique({
        where: {
          address: '0x104B4E127B9a6C82044c972cAfF88e75f41ae8Cc'.toLowerCase(),
          // address: '0x3E23a96D96A0E8D32063d3943d54a69D032e8B0d'.toLowerCase(),
        },
      });

      if (!user) {
        throw new Error('User not found');
      }

      this.mnemonic = await this.followerService.getMnemonic(
        user.mnemonic || '',
      );

      const arbFollower = await this.prismaService.follower.findFirst({
        where: {
          accountIndex: 2,
        },
      });
      // const polygonFollower = await this.prismaService.follower.findFirst({
      //   where: {
      //     accountIndex: 3,
      //   },
      // });
      // const baseFollower = await this.prismaService.follower.findFirst({
      //   where: {
      //     accountIndex: 4,
      //   },
      // });
      // const apeChainFollower = await this.prismaService.follower.findFirst({
      //   where: {
      //     accountIndex: 5,
      //   },
      // });

      if (
        !arbFollower
        // !polygonFollower ||
        // !baseFollower ||
        // !apeChainFollower
      ) {
        throw new Error('Follower not found');
      }

      this.vaultConfigs = {
        [arbitrum.id]: {
          follower: arbFollower,
        },
        // [polygon.id]: {
        //   follower: polygonFollower,
        // },
        // [base.id]: {
        //   follower: baseFollower,
        // },
        // [apeChain.id]: {
        //   follower: apeChainFollower,
        // },
      };

      this.status = ServiceStatus.READY;
      this.isRunning = true;
    } catch (err) {
      this.logger.log({
        severity: 'Error',
        summary: 'trading>bot-hook>init',
        details: getReadableError(err),
      });
    }
  }

  async stop() {
    this.isRunning = false;
  }

  async checkContractsForBots() {
    this.status = ServiceStatus.PROCESS;

    const contracts = await this.contractsService.findAll();

    const promises = contracts
      .filter((contract) => contract.status === ContractStatus.Live)
      .map((contract) => this.checkContractForBots(contract));

    await Promise.allSettled(promises);

    this.status = ServiceStatus.READY;
  }

  async checkContractForBots(contract: Contract) {
    try {
      const fromBlock = this.lastBlockNumbers[contract.id] + 1;

      const perpTradingEventLogs =
        await this.prismaService.perpTradingEventLog.findMany({
          where: {
            contractId: contract.id,
            block: {
              gte: fromBlock,
            },
          },
          orderBy: [
            {
              block: 'asc',
            },
            {
              logIndex: 'asc',
            },
            {
              id: 'asc',
            },
          ],
        });

      if (perpTradingEventLogs.length === 0) {
        return;
      }

      const missionActions = perpTradingEventLogs
        .map((log) =>
          getWeb3Info(contract.platform, contract.version).eventToActionParser(
            JSON.parse(log.jsonLog) as any,
          ),
        )
        .filter(
          (item) =>
            item.name === marketExecutedEventParser.eventName ||
            item.name === limitExecutedEventParser.eventName,
        );

      if (missionActions.length > 0) {
        await this.handleMissionActions(contract, missionActions);
      }

      const toBlock = Math.max(...perpTradingEventLogs.map((log) => log.block));

      this.lastBlockNumbers[contract.id] = Number(toBlock);
    } catch (err) {
      await this.logger.log({
        severity: 'Emergency',
        summary: 'bot-hook>checkContractForBots',
        details: `chainId:${contract.chainId} ${getReadableError(err)}`,
      });
    }
  }

  async handleMissionActions(contract: Contract, missionActions: ActionItem[]) {
    for (const action of missionActions) {
      let event: TradeEvent<
        MarketExecutedEventArgs | LimitExecutedEventArgs
      > | null = null;

      if (action.name === marketExecutedEventParser.eventName) {
        event = marketExecutedEventParser.actionParser(action);
      } else if (action.name === limitExecutedEventParser.eventName) {
        event = limitExecutedEventParser.actionParser(action);
      }

      if (!event) {
        continue;
      }

      try {
        // it's not a bot event
        if (event.args.user.toLowerCase() !== botAddress.toLowerCase()) {
          continue;
        }

        this.logger.log({
          severity: 'Debug',
          summary: 'trading>bot-hook>handleMissionEvent',
          details: `chainId:${contract.chainId} ${event.eventName}`,
        });

        const follower = this.vaultConfigs[contract.chainId].follower;

        const { t, collateralPriceUsd } = event.args;

        const pair = getPair(arbitrum.id, t.pairIndex);

        if (!pair) {
          throw new Error(
            `follower contract doesn't support this pairIndex: ${t.pairIndex}`,
          );
        }

        const collateral = getCollateral(arbitrum.id, t.collateralIndex);

        if (!collateral) {
          throw new Error(
            `follower contract doesn't support this collateral index: ${t.collateralIndex}`,
          );
        }

        let kind: 'open' | 'close' | null = null;

        if (event.eventName === marketExecutedEventParser.eventName) {
          if ((event as MarketExecutedEvent).args.open) {
            kind = 'open';
          } else {
            kind = 'close';
          }
        }

        if (event.eventName === limitExecutedEventParser.eventName) {
          if (
            [PendingOrderType.LIMIT_OPEN, PendingOrderType.STOP_OPEN].includes(
              (event as LimitExecutedEvent).args.orderType,
            )
          ) {
            kind = 'open';
          }

          if (
            [
              PendingOrderType.LIQ_CLOSE,
              PendingOrderType.SL_CLOSE,
              PendingOrderType.TP_CLOSE,
            ].includes((event as LimitExecutedEvent).args.orderType)
          ) {
            kind = 'close';
          }
        }

        if (kind === null) {
          continue;
        }

        if (kind === 'open') {
          const collateralUSDCAmount = Math.floor(
            (Number(t.collateralAmount) / Number(collateral.precision)) *
              (Number(collateralPriceUsd) / 100_000_000),
          );

          let ratioAmount = BigInt(
            Math.floor(collateralUSDCAmount * 0.1 * 1e6),
          );

          const maxCollateral = BigInt(70 * 1e6);
          const minCollateral = BigInt(5 * 1e6);

          ratioAmount =
            ratioAmount < maxCollateral ? ratioAmount : maxCollateral;
          ratioAmount =
            ratioAmount > minCollateral ? ratioAmount : minCollateral;

          await this.gnsService.openTrade({
            mnemonic: this.mnemonic,
            accountIndex: follower.accountIndex,
            contractId: this.followerContract.id,
            args: {
              trade: {
                user: follower.address as Address,
                index: 0,
                pairIndex: t.pairIndex,
                long: t.long,
                isOpen: true,
                collateralIndex:
                  USDCCollateralIndex[
                    this.followerContract
                      .chainId as keyof typeof USDCCollateralIndex
                  ],
                collateralAmount: ratioAmount,
                leverage: t.leverage,
                tradeType: TradeType.TRADE,
                openPrice: BigInt(t.openPrice),
                tp: 0n,
                sl: 0n,
                isCounterTrade: false,
                positionSizeToken: 0n,
                __placeholder: Number(t.__placeholder),
              },
              maxSlippageP: 1000,
            },
          });

          this.logger.log({
            severity: 'Emergency',
            summary: 'trading>bot-hook>handleMissionEvent',
            details: `chainId:${contract.chainId} open trade ${JSON.stringify(
              {
                trade: {
                  user: follower.address as Address,
                  index: 0,
                  pairIndex: t.pairIndex,
                  long: t.long,
                  isOpen: true,
                  collateralIndex:
                    USDCCollateralIndex[
                      this.followerContract
                        .chainId as keyof typeof USDCCollateralIndex
                    ],
                  collateralAmount: ratioAmount,
                  leverage: t.leverage,
                  tradeType: TradeType.TRADE,
                  openPrice: BigInt(t.openPrice),
                  tp: 0n,
                  sl: 0n,
                  isCounterTrade: false,
                  positionSizeToken: 0n,
                  __placeholder: Number(t.__placeholder),
                },
                maxSlippageP: 1000,
              },
              (_, v) => (typeof v === 'bigint' ? v.toString() : v),
            )}`,
          });
        }

        if (kind === 'close') {
          const trades = await this.gnsService.getTrades({
            contractId: this.followerContract.id,
            priority: ChainPriority.HIGH,
            args: {
              address: follower.address as Address,
            },
          });

          for (const trade of trades) {
            await this.gnsService.closeTradeMarket({
              mnemonic: this.mnemonic,
              accountIndex: follower.accountIndex,
              contractId: this.followerContract.id,
              args: {
                index: trade.index,
                expectedPrice: BigInt(t.openPrice),
              },
            });
          }

          this.logger.log({
            severity: 'Emergency',
            summary: 'trading>bot-hook>handleMissionEvent',
            details: `chainId:${contract.chainId} close ${trades.length} trades successfully ${JSON.stringify(
              trades,
              (_, v) => (typeof v === 'bigint' ? v.toString() : v),
            )}`,
          });
        }
      } catch (err) {
        this.logger.log({
          severity: 'Emergency',
          summary: 'trading>bot-hook>handleMissionEvent',
          details: `chainId:${contract.chainId} ${getReadableError(err)}`,
        });
      }
    }
  }
}
