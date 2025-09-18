import { Injectable } from '@nestjs/common';
import {
  Address,
  decodeEventLog,
  createPublicClient,
  PublicClient,
  webSocket,
  fallback,
  WatchContractEventReturnType,
  Log,
} from 'viem';
import {
  Contract,
  ContractStatus,
  Follower,
  Platform,
  Version,
} from '@prisma/client';
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
import { delay, getReadableError } from 'src/utils';
import { LogsService } from 'src/global/logs.service';

import { getWeb3Info } from 'src/web3/utils';

import { privateRPCProviders } from 'src/web3/web3/chains.service';
import { GnsService } from 'src/web3/platform/gns/gns.service';
import { PrismaService } from 'src/global/prisma.service';
import {
  MarketExecutedEvent,
  marketExecutedEventParser,
} from 'src/web3/platform/gns/v10/eventParsers/market-executed.parser';
import {
  LimitExecutedEvent,
  limitExecutedEventParser,
} from 'src/web3/platform/gns/v10/eventParsers/limit-executed.parser';
import { getCollateral, getPair } from 'src/web3/platform/gns/v10/configs';
import { FollowerService } from '../apiService/modules/follower/follower.service';
import { TradeType, PendingOrderType } from 'src/web3/platform/gns/v10/types';
import { ChainPriority } from 'src/types';
import { USDCCollateralIndex } from 'src/utils/constants';
import { gnsMultiCollatDiamondAbi } from 'src/web3/platform/gns/v10/abi/GNSMultiCollatDiamond';

const botAddress = '0xda227b42ffde9d3e4b209ee0e789a374f075e782';

@Injectable()
export class BotHookService {
  readonly availableChains: Chain[];
  private unwatchs: Record<number, WatchContractEventReturnType> = {};
  private vaultConfigs: Record<
    number,
    { follower: Follower; positionIndex?: number }
  > = {};
  private mnemonic: string;
  private followerContract: Contract;
  public isRunning: boolean = false;
  private round: Record<string, number> = {};

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

    this.unwatchs = {};

    this.init();
  }

  async hasRisky() {
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
  }

  async init() {
    try {
      const user = await this.prismaService.user.findUnique({
        where: {
          address: '0x3E23a96D96A0E8D32063d3943d54a69D032e8B0d'.toLowerCase(),
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
      const polygonFollower = await this.prismaService.follower.findFirst({
        where: {
          accountIndex: 3,
        },
      });
      const baseFollower = await this.prismaService.follower.findFirst({
        where: {
          accountIndex: 4,
        },
      });
      const apeChainFollower = await this.prismaService.follower.findFirst({
        where: {
          accountIndex: 5,
        },
      });

      if (
        !arbFollower ||
        !polygonFollower ||
        !baseFollower ||
        !apeChainFollower
      ) {
        throw new Error('Follower not found');
      }

      this.vaultConfigs = {
        [arbitrum.id]: {
          follower: arbFollower,
        },
        [polygon.id]: {
          follower: polygonFollower,
        },
        [base.id]: {
          follower: baseFollower,
        },
        [apeChain.id]: {
          follower: apeChainFollower,
        },
      };

      const contracts = await this.contractsService.findAll();

      this.followerContract = contracts.find(
        (contract) =>
          contract.platform === Platform.GNS &&
          contract.version === Version.V10,
      )!;

      if (!this.followerContract) {
        throw new Error('Follower contract not found');
      }

      const validContracts = contracts.filter(
        (contract) =>
          contract.status === ContractStatus.Live &&
          contract.platform === Platform.GNS &&
          !contract.isTestnet,
      );

      validContracts.forEach((contract) => {
        this.round[contract.chainId] = 0;
      });

      const promises = validContracts.map(async (contract) => {
        await this.registerBotMarketExecutedEventListeners(contract);
        await this.registerBotLimitExecutedEventListeners(contract);
      });

      await Promise.allSettled(promises);

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
    Object.values(this.unwatchs).forEach((unwatch) => unwatch());

    this.isRunning = false;
  }

  createWsClient(chainId: number, eventName: string) {
    const chain = this.availableChains.find((chain) => chain.id === chainId);

    if (!chain) {
      throw new Error(`Unsupported chain id: ${chainId}`);
    }

    const alchemyProvider = privateRPCProviders.alchemy;

    const roundKey = `${chainId}-${eventName}`;

    const token =
      alchemyProvider.tokens[
        this.round[roundKey] % alchemyProvider.tokens.length
      ];

    this.round[roundKey] = this.round[roundKey] + 1;

    return createPublicClient({
      chain: chain,
      transport: webSocket(
        alchemyProvider.getWebsocket(
          alchemyProvider.networks[
            chain.id as keyof typeof alchemyProvider.networks
          ],
          token,
        ),
        { reconnect: true },
      ),
    }) as unknown as PublicClient;
  }

  async registerBotMarketExecutedEventListeners(contract: Contract) {
    let client = this.createWsClient(
      contract.chainId,
      marketExecutedEventParser.eventName,
    );

    try {
      this.unwatchs[contract.id] = client.watchContractEvent({
        address: contract.address as Address,
        abi: gnsMultiCollatDiamondAbi,
        eventName: 'MarketExecuted',
        onLogs: (logs) => {
          if (logs.length === 0) {
            return;
          }

          this.handleMissionEvent(contract, logs);
        },
        onError: async (err) => {
          this.logger.log({
            severity: 'Debug',
            summary: 'trading>bot-hook>registerBotMarketExecutedEventListeners',
            details: `chainId:${contract.chainId} ${getReadableError(err)}`,
          });

          await delay(5_000);

          this.unwatchs[contract.id]();
          this.registerBotMarketExecutedEventListeners(contract);
        },
      });

      console.log('setuped bot-hook service', contract.chainId);
    } catch (err) {
      this.logger.log({
        severity: 'Debug',
        summary: 'trading>bot-hook>registerBotMarketExecutedEventListeners',
        details: `chainId:${contract.chainId} ${getReadableError(err)}`,
      });

      await delay(5_000);

      this.unwatchs[contract.id]();
      this.registerBotMarketExecutedEventListeners(contract);
    }
  }

  async registerBotLimitExecutedEventListeners(contract: Contract) {
    let client = this.createWsClient(
      contract.chainId,
      limitExecutedEventParser.eventName,
    );

    try {
      this.unwatchs[contract.id] = client.watchContractEvent({
        address: contract.address as Address,
        abi: gnsMultiCollatDiamondAbi,
        eventName: 'LimitExecuted',
        onLogs: (logs) => {
          if (logs.length === 0) {
            return;
          }

          this.handleMissionEvent(contract, logs);
        },
        onError: async (err) => {
          this.logger.log({
            severity: 'Debug',
            summary: 'trading>bot-hook>registerBotLimitExecutedEventListeners',
            details: `chainId:${contract.chainId} ${getReadableError(err)}`,
          });

          await delay(5_000);

          this.unwatchs[contract.id]();
          this.registerBotLimitExecutedEventListeners(contract);
        },
      });

      console.log('setuped bot-hook service', contract.chainId);
    } catch (err) {
      this.logger.log({
        severity: 'Debug',
        summary: 'trading>bot-hook>registerBotLimitExecutedEventListeners',
        details: `chainId:${contract.chainId} ${getReadableError(err)}`,
      });

      await delay(5_000);

      this.unwatchs[contract.id]();
      this.registerBotLimitExecutedEventListeners(contract);
    }
  }

  async handleMissionEvent(contract: Contract, logs: Log[]) {
    const missionEvents = logs
      .filter((log) => log.topics.length > 0)
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

        return decoded;
      })
      .filter(
        (item) =>
          item.eventName === marketExecutedEventParser.eventName ||
          item.eventName === limitExecutedEventParser.eventName,
      ) as (MarketExecutedEvent | LimitExecutedEvent)[];

    if (missionEvents.length === 0) {
      return;
    }

    for (const event of missionEvents) {
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
            severity: 'Debug',
            summary: 'trading>bot-hook>handleMissionEvent',
            details: `chainId:${contract.chainId} open trade`,
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
            severity: 'Debug',
            summary: 'trading>bot-hook>handleMissionEvent',
            details: `chainId:${contract.chainId} close ${trades.length} trades successfully`,
          });
        }
      } catch (err) {
        this.logger.log({
          severity: 'Debug',
          summary: 'trading>bot-hook>handleMissionEvent',
          details: `chainId:${contract.chainId} ${getReadableError(err)}`,
        });
      }
    }
  }
}
