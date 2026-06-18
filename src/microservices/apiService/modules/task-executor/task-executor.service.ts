import { Injectable } from '@nestjs/common';
import { Address, decodeEventLog } from 'viem';
import {
  MissionStatus,
  TaskStatus,
  UserPermission,
  Platform,
  MissionMode,
} from 'generated/prisma/client';
import dayjs from 'dayjs';

import { PrismaService } from 'src/global/prisma.service';
import { MissionsService } from 'src/microservices/apiService/modules/missions/missions.service';
import { TasksService } from 'src/microservices/apiService/modules/tasks/tasks.service';
import { FollowerService } from 'src/microservices/apiService/modules/follower/follower.service';
import { LogsService } from 'src/global/logs.service';
import { ActionsService } from 'src/microservices/apiService/modules/actions/actions.service';
import { GnsService } from 'src/web3/platform/gns/gns.service';
import { EvmAdapterService } from 'src/web3/web3/evm-adapter.service';

import { tradeMaxClosingSlippagePUpdatedEventParser } from 'src/web3/platform/gns/v10/eventParsers/trade-max-closing-slippage-p-updated.parser';
import { leverageUpdateExecutedEventParser } from 'src/web3/platform/gns/v10/eventParsers/leverage-update-executed.parser';
import { positionSizeIncreaseExecutedEventParser } from 'src/web3/platform/gns/v10/eventParsers/position-size-increase-executed.parser';
import { positionSizeDecreaseExecutedEventParser } from 'src/web3/platform/gns/v10/eventParsers/position-size-decrease-executed.parser';
import { marginUpdateExecutedEventParser as avntMarginUpdateExecutedV1EventParser } from 'src/web3/platform/avnt/v1/eventParsers/margin-update-executed.parser';

import { positionIncreaseEventParser as gmxPositionIncreaseEventParser } from 'src/web3/platform/gmx/v2/eventParsers/position-increase.parser';
import { positionDecreaseEventParser as gmxPositionDecreaseEventParser } from 'src/web3/platform/gmx/v2/eventParsers/position-decrease.parser';
import { eventParsers as gmxEventParsers } from 'src/web3/platform/gmx/v2/eventParsers';

import {
  missionEventNames,
  missionEventParsers,
  eventParsers,
  eventToActionParser,
} from 'src/web3/platform/gns/v10/eventParsers';

import { gnsMultiCollatDiamondAbi } from 'src/web3/platform/gns/v10/abi/GNSMultiCollatDiamond';
import {
  clampStrategyLeverage,
  getOpenMissionParams,
  getPositionDecreaseParams,
  getPositionIncreaseParams,
} from 'src/microservices/apiService/modules/strategy/strategy-library';
import {
  ChainPriority,
  CloseMissionActionArgs,
  OpenMissionActionArgs,
} from 'src/types';
import { TradeType } from 'src/web3/platform/gns/v10/types';

import { TaskBackwardDetails } from 'src/microservices/apiService/modules/tasks/entities/task.entity';

import {
  CloseMissionAction,
  OpenMissionAction,
  MainCollateralIndex,
} from 'src/utils/constants';

import { getReadableError } from 'src/utils';

import { TaskUpdateInput } from 'src/microservices/apiService/modules/tasks/dto/task.input';

import { MIN_FEE } from 'src/utils/constants';
import { marketOrderInitiatedEventParser } from 'src/web3/platform/gns/v10/eventParsers/market-order-initiated.parser';
import { ServiceStatus } from 'src/types';

import { getWeb3Info } from 'src/web3/utils';
import {
  getGnsPositionKey,
  parseGnsPositionKey,
} from 'src/web3/platform/gns/utils';
import { getMarketInfo, getTokenInfo } from 'src/web3/platform/gmx/v2/configs';
import {
  getCollateral,
  getPair,
  getPairIndex,
} from 'src/web3/platform/gns/v10/configs';
import { parseAvntPositionKey } from 'src/web3/platform/avnt/utils';
import {
  missionEventParsers as avntMissionEventParsers,
  missionEventNames as avntMissionEventNames,
} from 'src/web3/platform/avnt/v1/eventParsers';
import { getPairName as getAvntPairName } from 'src/web3/platform/avnt/v1/configs';

const expectedEventSignatures: Record<string, string> = Object.fromEntries(
  gnsMultiCollatDiamondAbi
    .filter((item) => item.type === 'event')
    .map((item) => [item.signature, item.name]),
);

const registeredEventNames = eventParsers.map((item) => item.eventName);

@Injectable()
export class TaskExecutorService {
  status: ServiceStatus = ServiceStatus.READY;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly followerService: FollowerService,
    private readonly missionsService: MissionsService,
    private readonly tasksService: TasksService,
    private readonly logger: LogsService,
    private readonly actionsService: ActionsService,
    private readonly evmAdapterService: EvmAdapterService,
    private readonly gnsService: GnsService,
  ) {
    this.status = ServiceStatus.READY;
  }

  private async performTask(
    task: TaskBackwardDetails,
  ): Promise<{ success: 'success' | 'failed' | 'skipped'; message: string }> {
    let tx: `0x${string}` | null = null;

    try {
      const { action, mission } = task;
      const { bot, achievePositionKey } = mission;
      const { follower, followerContract, leaderContract, strategy } = bot;

      if (
        task.status !== TaskStatus.Created &&
        task.status !== TaskStatus.Failed
      ) {
        throw new Error('Invalid task status');
      }

      if (
        !(
          getWeb3Info(
            leaderContract.platform,
            leaderContract.version,
          ).isOpenMissionAction(action) || action.name === OpenMissionAction
        ) &&
        !achievePositionKey
      ) {
        throw new Error(
          'Wrong Execuation of task, Task does not have its achievePosition',
        );
      }

      const user = await this.prismaService.user.findUnique({
        where: {
          address: task.mission.bot.plan.userId,
        },
      });

      if (!user) {
        throw new Error('User not found');
      }

      const followerCollateral = getCollateral(
        followerContract.chainId,
        MainCollateralIndex[
          followerContract.chainId as keyof typeof MainCollateralIndex
        ],
      );

      if (!followerCollateral) {
        await this.missionsService.closeMany([{ id: mission.id }], new Map());

        throw new Error(
          `follower contract doesn't support this collateral index: ${
            MainCollateralIndex[
              followerContract.chainId as keyof typeof MainCollateralIndex
            ]
          }`,
        );
      }

      const mnemonic = await this.followerService.getMnemonic(
        user.mnemonic || '',
      );

      if (action.name === CloseMissionAction) {
        const args = JSON.parse(action.args) as CloseMissionActionArgs;

        const achievePosition = parseGnsPositionKey(achievePositionKey!);

        tx = await this.gnsService.closeTradeMarket({
          mnemonic,
          accountIndex: follower.accountIndex,
          contractId: followerContract.id,
          args: {
            index: achievePosition!.index,
            expectedPrice: BigInt(args.expectedPrice),
          },
        });
      } else if (action.name === OpenMissionAction) {
        const args = JSON.parse(action.args) as OpenMissionActionArgs;

        tx = await this.gnsService.openTrade({
          mnemonic,
          accountIndex: follower.accountIndex,
          contractId: followerContract.id,
          args: {
            trade: {
              collateralAmount: BigInt(
                (Number(args.collateralAmountUSDC) *
                  Number(followerCollateral.precision)) /
                  1e6,
              ),
              leverage: args.leverage,
              long: args.long,
              openPrice: BigInt(args.openPrice),
              tp: BigInt(args.tp),
              sl: BigInt(args.sl),
              user: follower.address as Address,
              index: 0,
              pairIndex: args.pairIndex,
              isOpen: true,
              collateralIndex:
                MainCollateralIndex[
                  followerContract.chainId as keyof typeof MainCollateralIndex
                ],
              tradeType: TradeType.TRADE,
              isCounterTrade: false,
              positionSizeToken: 0n,
              __placeholder: 0,
            },
            maxSlippageP: 1000,
          },
        });

        await this.handleGNSOpenTradeTransaction(task, tx);
      } else if (leaderContract.platform === Platform.GNS) {
        switch (action.name) {
          case tradeMaxClosingSlippagePUpdatedEventParser.eventName: {
            const { args } =
              tradeMaxClosingSlippagePUpdatedEventParser.actionParser(action);

            const achievePosition = parseGnsPositionKey(achievePositionKey!);

            tx = await this.gnsService.updateMaxClosingSlippageP({
              mnemonic,
              accountIndex: follower.accountIndex,
              contractId: followerContract.id,
              args: {
                index: achievePosition!.index,
                maxSlippageP: args.maxClosingSlippageP,
              },
            });

            break;
          }
          case leverageUpdateExecutedEventParser.eventName: {
            const { args } =
              leverageUpdateExecutedEventParser.actionParser(action);

            const achievePosition = parseGnsPositionKey(achievePositionKey!);
            const followerTradeData = await this.gnsService.getTrade({
              contractId: followerContract.id,
              priority: ChainPriority.HIGH,
              args: {
                address: follower.address as Address,
                index: achievePosition!.index,
              },
            });

            const targetLeverage = clampStrategyLeverage(
              strategy,
              Number(args.values.newLeverage),
            );

            if (targetLeverage === Number(followerTradeData.leverage)) {
              return {
                success: 'skipped',
                message: `Skipped leverage update because current leverage already matches target`,
              };
            }

            tx = await this.gnsService.updateLeverage({
              mnemonic,
              accountIndex: follower.accountIndex,
              contractId: followerContract.id,
              args: {
                index: achievePosition!.index,
                newLeverage: targetLeverage,
              },
            });

            break;
          }
          case positionSizeIncreaseExecutedEventParser.eventName: {
            const { args } =
              positionSizeIncreaseExecutedEventParser.actionParser(action);

            const achievePosition = parseGnsPositionKey(achievePositionKey!);

            const followerTradeData = await this.gnsService.getTrade({
              contractId: followerContract.id,
              priority: ChainPriority.HIGH,
              args: {
                address: follower.address as Address,
                index: achievePosition!.index,
              },
            });

            const leaderCollateral = getCollateral(
              leaderContract.chainId,
              args.collateralIndex,
            );

            if (!leaderCollateral) {
              await this.missionsService.closeMany(
                [{ id: mission.id }],
                new Map(),
              );

              throw new Error(
                `leader contract doesn't support this collateral index: ${args.collateralIndex}`,
              );
            }

            const increaseParams = getPositionIncreaseParams(
              strategy,
              {
                collateralDelta: BigInt(args.collateralDelta),
                leverageDelta: BigInt(args.leverageDelta),
                newLeverage: BigInt(args.values.newLeverage),
                newOpenPrice: BigInt(args.values.newOpenPrice),
              },
              leaderCollateral,
              followerTradeData,
            );

            if (increaseParams === null) {
              return {
                success: 'skipped',
                message: `Skipped this position size update because no need to increase position`,
              };
            }

            if (increaseParams.collateralDelta > 0n) {
              const fee = BigInt(
                Math.max(
                  Math.floor(
                    (Number(increaseParams.collateralDelta) *
                      Number(increaseParams.leverageDelta) *
                      0.16) /
                      1e5,
                  ),
                  Number(MIN_FEE),
                ),
              );

              const positionDelta = BigInt(
                Math.floor(
                  (Number(increaseParams.collateralDelta) *
                    Number(increaseParams.leverageDelta)) /
                    1e3,
                ),
              );

              // if new position size is less than fee, skip the update
              if (positionDelta < fee) {
                return {
                  success: 'skipped',
                  message: `Skipped this position size update because collateral delta is too small`,
                };
              }
            }

            tx = await this.gnsService.increasePositionSize({
              mnemonic,
              accountIndex: follower.accountIndex,
              contractId: followerContract.id,
              args: {
                ...increaseParams,
                collateralDelta: BigInt(
                  Math.floor(
                    (Number(increaseParams.collateralDelta) *
                      Number(followerCollateral.precision)) /
                      1e6,
                  ),
                ),
                index: achievePosition!.index,
                maxSlippageP: 1000,
              },
            });

            break;
          }
          case positionSizeDecreaseExecutedEventParser.eventName: {
            const { args } =
              positionSizeDecreaseExecutedEventParser.actionParser(action);

            const achievePosition = parseGnsPositionKey(achievePositionKey!);

            const followerTradeData = await this.gnsService.getTrade({
              contractId: followerContract.id,
              priority: ChainPriority.HIGH,
              args: {
                address: follower.address as Address,
                index: achievePosition!.index,
              },
            });

            const decreaseParams = getPositionDecreaseParams(
              strategy,
              {
                isLeverageUpdate: Number(args.collateralDelta) === 0,
                existingPositionSizeCollateral: BigInt(
                  args.values.existingPositionSizeCollateral,
                ),
                positionSizeCollateralDelta: BigInt(
                  args.values.positionSizeCollateralDelta,
                ),
                oraclePrice: BigInt(args.oraclePrice),
              },
              followerTradeData,
            );

            if (decreaseParams === null) {
              return {
                success: 'skipped',
                message: `Skipped this position size update because no need to decrease position`,
              };
            }

            tx = await this.gnsService.decreasePositionSize({
              mnemonic,
              accountIndex: follower.accountIndex,
              contractId: followerContract.id,
              args: {
                ...decreaseParams,
                index: achievePosition!.index,
              },
            });

            if (tx) {
              // await this.followerService.withdrawAllUSDC(
              //   task.mission.bot.plan.userId,
              //   follower.address,
              //   followerContract.id,
              // );

              return {
                success: 'success',
                message: `Task achieved tx: ${tx}`,
              };
            }

            break;
          }
          default: {
            if (missionEventNames.includes(action.name)) {
              const event = missionEventParsers
                .find((parser) => parser.eventName === action.name)!
                .actionParser(action);
              const { t, collateralPriceUsd, isManualOpen } = event.args;

              const pair = getPair(followerContract.chainId, t.pairIndex);

              if (!pair) {
                await this.missionsService.closeMany(
                  [{ id: mission.id }],
                  new Map(),
                );

                throw new Error(
                  `follower contract doesn't support this pairIndex: ${t.pairIndex}`,
                );
              }

              const leaderCollateral = getCollateral(
                leaderContract.chainId,
                t.collateralIndex,
              );

              if (!leaderCollateral) {
                await this.missionsService.closeMany(
                  [{ id: mission.id }],
                  new Map(),
                );

                throw new Error(
                  `leader contract doesn't support this collateral index: ${t.collateralIndex}`,
                );
              }

              if (
                getWeb3Info(
                  leaderContract.platform,
                  leaderContract.version,
                ).isOpenMissionAction(action)
              ) {
                const openMissionParams = isManualOpen
                  ? {
                      collateralAmount: BigInt(t.collateralAmount),
                      leverage: t.leverage,
                      long: t.long,
                      openPrice: BigInt(t.openPrice),
                      tp: 0n,
                      sl: 0n,
                    }
                  : getOpenMissionParams(
                      strategy,
                      {
                        leverage: t.leverage,
                        collateralAmount: BigInt(t.collateralAmount),
                        collateralPriceUsd: BigInt(collateralPriceUsd),
                        collateral: leaderCollateral,
                        isLong: t.long,
                        openPrice: BigInt(t.openPrice),
                        usdcPrice: 100_000_000n,
                        pairIndex: t.pairIndex,
                      },
                      bot.leaderCollateralBaseline,
                    );

                tx = await this.gnsService.openTrade({
                  mnemonic,
                  accountIndex: follower.accountIndex,
                  contractId: followerContract.id,
                  args: {
                    trade: {
                      ...openMissionParams,
                      collateralAmount: BigInt(
                        Math.floor(
                          (Number(openMissionParams.collateralAmount) *
                            Number(followerCollateral.precision)) /
                            1e6,
                        ),
                      ),
                      user: follower.address as Address,
                      index: 0,
                      pairIndex: t.pairIndex,
                      isOpen: true,
                      collateralIndex:
                        MainCollateralIndex[
                          followerContract.chainId as keyof typeof MainCollateralIndex
                        ],
                      tradeType: TradeType.TRADE,
                      isCounterTrade: false,
                      positionSizeToken: 0n,
                      __placeholder: Number(t.__placeholder),
                    },
                    maxSlippageP: 1000,
                  },
                });

                await this.handleGNSOpenTradeTransaction(task, tx);
              }

              if (
                getWeb3Info(
                  leaderContract.platform,
                  leaderContract.version,
                ).isCloseMissionAction(action)
              ) {
                const achievePosition = parseGnsPositionKey(
                  achievePositionKey!,
                );

                tx = await this.gnsService.closeTradeMarket({
                  mnemonic,
                  accountIndex: follower.accountIndex,
                  contractId: followerContract.id,
                  args: {
                    index: achievePosition!.index,
                    expectedPrice: BigInt(t.openPrice),
                  },
                });

                if (tx) {
                  return {
                    success: 'success',
                    message: `Task achieved tx: ${tx}`,
                  };
                }
              }
            }

            break;
          }
        }
      } else if (leaderContract.platform === Platform.GMX) {
        const gmxEvent = gmxEventParsers
          .find((parser) => parser.eventName === action.name)!
          .actionParser(action);

        const marketInfo = getMarketInfo(
          bot.leaderContract.chainId,
          gmxEvent.args.market,
        );

        const collateral = getTokenInfo(
          bot.leaderContract.chainId,
          gmxEvent.args.collateralToken,
        );

        if (!marketInfo || !collateral) {
          await this.missionsService.closeMany([{ id: mission.id }], new Map());

          throw new Error(
            `Current gmx configuration doesn't support this market: ${gmxEvent.args.market} on chain ${bot.leaderContract.chainId}`,
          );
        }

        const pairName =
          `${marketInfo.indexToken.baseSymbol || marketInfo.indexToken.symbol}/usd`.toLowerCase();

        const pairIndex = getPairIndex(followerContract.chainId, pairName);

        if (pairIndex === -1) {
          await this.missionsService.closeMany([{ id: mission.id }], new Map());

          throw new Error(
            `follower contract doesn't support this pairName: ${pairName}`,
          );
        }

        const pair = getPair(followerContract.chainId, pairIndex);

        if (!pair) {
          await this.missionsService.closeMany([{ id: mission.id }], new Map());

          throw new Error(
            `follower contract doesn't support this pairName: ${pairName}`,
          );
        }

        const executionPrice = BigInt(
          Math.floor(
            Number(gmxEvent.args.executionPrice) /
              Math.pow(10, 30 - marketInfo.indexToken.decimals - 10),
          ),
        );

        const sizeInUsd = Number(gmxEvent.args.sizeInUsd) / 1e30;
        const collateralInUsd =
          (Number(gmxEvent.args.collateralAmount) *
            Number(gmxEvent.args['collateralTokenPrice.max'])) /
          1e30;

        const leverage =
          collateralInUsd > 0
            ? Math.floor((sizeInUsd / collateralInUsd) * 1e3)
            : 0;
        const clampedLeverage = clampStrategyLeverage(strategy, leverage);

        const sizeDeltaUsd = Number(gmxEvent.args.sizeDeltaUsd) / 1e30;
        const collateralDeltaUsd =
          (Number(gmxEvent.args.collateralDeltaAmount) *
            Number(gmxEvent.args['collateralTokenPrice.max'])) /
          1e30;
        const leverageDelta =
          collateralDeltaUsd > 0
            ? Math.floor((sizeDeltaUsd / collateralDeltaUsd) * 1e3)
            : 0;

        switch (action.name) {
          case gmxPositionIncreaseEventParser.eventName: {
            const { args } =
              gmxPositionIncreaseEventParser.actionParser(action);

            // it's a open position event
            if (args.sizeInUsd === args.sizeDeltaUsd) {
              const openMissionParams = getOpenMissionParams(
                strategy,
                {
                  leverage,
                  collateralAmount: BigInt(args.collateralAmount),
                  collateralPriceUsd: BigInt(
                    Math.floor(
                      Number(args['collateralTokenPrice.max']) /
                        Math.pow(10, 30 - collateral.decimals - 8),
                    ),
                  ),
                  collateral: {
                    collateralIndex: 0,
                    isActive: true,
                    collateral: collateral.address as `0x${string}`,
                    precision: BigInt(Math.pow(10, collateral.decimals)),
                    precisionDelta: 0n,
                    __placeholder: 0n,
                  },
                  isLong: args.isLong,
                  openPrice: executionPrice,
                  usdcPrice: 100_000_000n,
                  pairIndex: pairIndex,
                },
                bot.leaderCollateralBaseline,
              );

              tx = await this.gnsService.openTrade({
                mnemonic,
                accountIndex: follower.accountIndex,
                contractId: followerContract.id,
                args: {
                  trade: {
                    ...openMissionParams,
                    collateralAmount: BigInt(
                      Math.floor(
                        (Number(openMissionParams.collateralAmount) *
                          Number(followerCollateral.precision)) /
                          1e6,
                      ),
                    ),
                    user: follower.address as Address,
                    index: 0,
                    pairIndex: pairIndex,
                    isOpen: true,
                    collateralIndex:
                      MainCollateralIndex[
                        followerContract.chainId as keyof typeof MainCollateralIndex
                      ],
                    tradeType: TradeType.TRADE,
                    isCounterTrade: false,
                    positionSizeToken: 0n,
                    __placeholder: 0,
                  },
                  maxSlippageP: 1000,
                },
              });

              await this.handleGNSOpenTradeTransaction(task, tx);
            } else if (Number(args.sizeDeltaUsd) === 0) {
              // it's a leverage update event
              const achievePosition = parseGnsPositionKey(achievePositionKey!);

              tx = await this.gnsService.updateLeverage({
                mnemonic,
                accountIndex: follower.accountIndex,
                contractId: followerContract.id,
                args: {
                  index: achievePosition!.index,
                  newLeverage: clampedLeverage,
                },
              });
            } else {
              // it's a increase position size event
              const achievePosition = parseGnsPositionKey(achievePositionKey!);

              const followerTradeData = await this.gnsService.getTrade({
                contractId: followerContract.id,
                priority: ChainPriority.HIGH,
                args: {
                  address: follower.address as Address,
                  index: achievePosition!.index,
                },
              });

              const increaseParams = getPositionIncreaseParams(
                strategy,
                {
                  collateralDelta: BigInt(args.collateralDeltaAmount),
                  leverageDelta: BigInt(leverageDelta),
                  newLeverage: BigInt(clampedLeverage),
                  newOpenPrice: BigInt(executionPrice),
                },
                {
                  collateralIndex: 0,
                  isActive: true,
                  collateral: collateral.address as `0x${string}`,
                  precision: BigInt(Math.pow(10, collateral.decimals)),
                  precisionDelta: 0n,
                  __placeholder: 0n,
                },
                followerTradeData,
              );

              if (increaseParams === null) {
                return {
                  success: 'skipped',
                  message: `Skipped this position size update because no need to increase position`,
                };
              }

              if (increaseParams.collateralDelta > 0n) {
                const fee = BigInt(
                  Math.max(
                    Math.floor(
                      (Number(increaseParams.collateralDelta) *
                        Number(increaseParams.leverageDelta) *
                        0.16) /
                        1e5,
                    ),
                    Number(MIN_FEE),
                  ),
                );

                const positionDelta = BigInt(
                  Math.floor(
                    (Number(increaseParams.collateralDelta) *
                      Number(increaseParams.leverageDelta)) /
                      1e3,
                  ),
                );

                // if new position size is less than fee, skip the update
                if (positionDelta < fee) {
                  return {
                    success: 'skipped',
                    message: `Skipped this position size update because collateral delta is too small`,
                  };
                }
              }

              tx = await this.gnsService.increasePositionSize({
                mnemonic,
                accountIndex: follower.accountIndex,
                contractId: followerContract.id,
                args: {
                  ...increaseParams,
                  collateralDelta: BigInt(
                    Math.floor(
                      (Number(increaseParams.collateralDelta) *
                        Number(followerCollateral.precision)) /
                        1e6,
                    ),
                  ),
                  index: achievePosition!.index,
                  maxSlippageP: 1000,
                },
              });
            }

            break;
          }
          case gmxPositionDecreaseEventParser.eventName: {
            const achievePosition = parseGnsPositionKey(achievePositionKey!);

            const { args } =
              gmxPositionDecreaseEventParser.actionParser(action);

            // it's a close position event
            if (Number(args.sizeInUsd) === 0) {
              tx = await this.gnsService.closeTradeMarket({
                mnemonic,
                accountIndex: follower.accountIndex,
                contractId: followerContract.id,
                args: {
                  index: achievePosition!.index,
                  expectedPrice: BigInt(executionPrice),
                },
              });

              if (tx) {
                return {
                  success: 'success',
                  message: `Task achieved tx: ${tx}`,
                };
              }
            } else if (Number(args.sizeDeltaUsd) === 0) {
              // it's a leverage update event
              tx = await this.gnsService.updateLeverage({
                mnemonic,
                accountIndex: follower.accountIndex,
                contractId: followerContract.id,
                args: {
                  index: achievePosition!.index,
                  newLeverage: clampedLeverage,
                },
              });
            } else {
              // it's a decrease position size event

              const followerTradeData = await this.gnsService.getTrade({
                contractId: followerContract.id,
                priority: ChainPriority.HIGH,
                args: {
                  address: follower.address as Address,
                  index: achievePosition!.index,
                },
              });

              const decreaseParams = getPositionDecreaseParams(
                strategy,
                {
                  isLeverageUpdate: false,
                  existingPositionSizeCollateral: BigInt(args.sizeInTokens),
                  positionSizeCollateralDelta: BigInt(args.sizeDeltaInTokens),
                  oraclePrice: BigInt(executionPrice),
                },
                followerTradeData,
              );

              if (
                decreaseParams === null ||
                (decreaseParams.collateralDelta === 0n &&
                  decreaseParams.leverageDelta === 0)
              ) {
                return {
                  success: 'skipped',
                  message: `Skipped this position size update because no need to decrease position`,
                };
              }

              tx = await this.gnsService.decreasePositionSize({
                mnemonic,
                accountIndex: follower.accountIndex,
                contractId: followerContract.id,
                args: {
                  ...decreaseParams,
                  index: achievePosition!.index,
                },
              });

              if (tx) {
                return {
                  success: 'success',
                  message: `Task achieved tx: ${tx}`,
                };
              }
            }

            break;
          }
          default: {
            break;
          }
        }
      } else if (leaderContract.platform === Platform.AVNT) {
        switch (action.name) {
          case avntMarginUpdateExecutedV1EventParser.eventName: {
            const { args } =
              avntMarginUpdateExecutedV1EventParser.actionParser(action);

            const achievePosition = parseAvntPositionKey(achievePositionKey!);

            const leverage = Math.floor(
              Math.max(
                strategy.minLeverage,
                Math.min(
                  strategy.maxLeverage,
                  Number(args.newTrade.leverage) / 1e7,
                ),
              ),
            );

            tx = await this.gnsService.updateLeverage({
              mnemonic,
              accountIndex: follower.accountIndex,
              contractId: followerContract.id,
              args: {
                index: achievePosition!.index,
                newLeverage: leverage,
              },
            });

            break;
          }
          default: {
            if (avntMissionEventNames.includes(action.name)) {
              const event = avntMissionEventParsers
                .find((parser) => parser.eventName === action.name)!
                .actionParser(action);
              const { t } = event.args;

              const pairName = getAvntPairName(Number(t.pairIndex));

              if (!pairName) {
                await this.missionsService.closeMany(
                  [{ id: mission.id }],
                  new Map(),
                );

                throw new Error(
                  `Leader contract doesn't support this pair name: ${pairName}`,
                );
              }

              const pairIndex = getPairIndex(
                followerContract.chainId,
                pairName,
              );

              if (pairIndex === -1) {
                await this.missionsService.closeMany(
                  [{ id: mission.id }],
                  new Map(),
                );

                throw new Error(
                  `Follower contract doesn't support this pairIndex: ${pairIndex}`,
                );
              }

              if (
                getWeb3Info(
                  leaderContract.platform,
                  leaderContract.version,
                ).isOpenMissionAction(action)
              ) {
                const openMissionParams = getOpenMissionParams(
                  strategy,
                  {
                    leverage: Math.floor(Number(t.leverage) / 1e7),
                    collateralAmount: BigInt(t.initialPosToken),
                    collateralPriceUsd: 100_000_000n,
                    collateral: {
                      collateralIndex: 0,
                      isActive: true,
                      collateral:
                        `0x0000000000000000000000000000000000000000` as `0x${string}`,
                      precision: 1000_000n,
                      precisionDelta: 0n,
                      __placeholder: 0n,
                    },
                    isLong: t.buy,
                    openPrice: BigInt(t.openPrice),
                    usdcPrice: 100_000_000n,
                    pairIndex,
                  },
                  bot.leaderCollateralBaseline,
                );

                tx = await this.gnsService.openTrade({
                  mnemonic,
                  accountIndex: follower.accountIndex,
                  contractId: followerContract.id,
                  args: {
                    trade: {
                      ...openMissionParams,
                      collateralAmount: BigInt(
                        Math.floor(
                          (Number(openMissionParams.collateralAmount) *
                            Number(followerCollateral.precision)) /
                            1e6,
                        ),
                      ),
                      user: follower.address as Address,
                      index: 0,
                      pairIndex,
                      isOpen: true,
                      collateralIndex:
                        MainCollateralIndex[
                          followerContract.chainId as keyof typeof MainCollateralIndex
                        ],
                      tradeType: TradeType.TRADE,
                      isCounterTrade: false,
                      positionSizeToken: 0n,
                      __placeholder: 0,
                    },
                    maxSlippageP: 1000,
                  },
                });

                await this.handleGNSOpenTradeTransaction(task, tx);
              }

              if (
                getWeb3Info(
                  leaderContract.platform,
                  leaderContract.version,
                ).isCloseMissionAction(action)
              ) {
                const achievePosition = parseAvntPositionKey(
                  achievePositionKey!,
                );

                tx = await this.gnsService.closeTradeMarket({
                  mnemonic,
                  accountIndex: follower.accountIndex,
                  contractId: followerContract.id,
                  args: {
                    index: achievePosition!.index,
                    expectedPrice: BigInt(t.openPrice),
                  },
                });

                if (tx) {
                  return {
                    success: 'success',
                    message: `Task achieved tx: ${tx}`,
                  };
                }
              }
            }

            break;
          }
        }
      }

      if (tx) {
        await this.logger.log({
          severity: 'Info',
          summary: 'TaskExecutorService>performTask',
          details: `tx: ${tx}`,
        });

        return {
          success: 'success',
          message: `Task achieved tx: ${tx}`,
        };
      } else {
        throw new Error('Error at waiting for transaction receipt');
      }
    } catch (err) {
      await this.logger.log({
        severity: 'Error',
        summary: `TaskExecutorService>performTask tx: ${tx}`,
        details: getReadableError(err),
      });

      return {
        success: 'failed',
        message: getReadableError(err) + ` tx: ${tx}`,
      };
    }
  }

  private async handleGNSOpenTradeTransaction(
    task: TaskBackwardDetails,
    tx: `0x${string}`,
  ) {
    const { mission } = task;
    const { bot } = mission;

    const transaction = await this.evmAdapterService.waitForTransactionReceipt({
      hash: tx,
      priority: ChainPriority.HIGH,
      chainId: bot.followerContract.chainId,
      confirmations: 1,
    });

    if (transaction.status !== 'success') {
      throw new Error(`Failed at open trade tx: ${tx}`);
    }

    for (const log of transaction.logs) {
      if (
        log.topics.length > 0 &&
        registeredEventNames.includes(
          expectedEventSignatures[log.topics[0] as string],
        )
      ) {
        const parsed = eventToActionParser(
          decodeEventLog({
            abi: gnsMultiCollatDiamondAbi,
            data: log.data,
            topics: log.topics,
          }) as any,
        );

        if (parsed.name === marketOrderInitiatedEventParser.eventName) {
          const { args } = marketOrderInitiatedEventParser.actionParser(parsed);

          if (!args.open) {
            continue;
          }

          const actions = await this.actionsService.createMany([
            {
              name: parsed.name,
              address: args.orderId.user.toLowerCase(),
              positionKey: getGnsPositionKey(
                args.orderId.user.toLowerCase(),
                args.orderId.index,
              ),
              args: parsed.args,
              blockNumber: Number(log.blockNumber),
              orderInBlock: log.logIndex,
            },
          ]);

          if (actions.length === 0) {
            continue;
          }

          await this.missionsService.attachAchievePositionMany(
            [
              {
                id: mission.id,
                achievePositionKey: actions[0].positionKey,
                status: MissionStatus.Opening,
              },
            ],
            new Map(),
          );
        }
      }
    }
  }

  async performTaskById(userId: string, taskId: number): Promise<boolean> {
    const task = await this.prismaService.task.findUnique({
      where: {
        id: taskId,
        mission: {
          bot: {
            plan: {
              userId,
            },
          },
        },
      },
      include: {
        action: true,
        followerActions: {
          include: {
            action: true,
          },
        },
        mission: {
          include: {
            bot: {
              include: {
                follower: true,
                strategy: true,
                leaderContract: true,
                followerContract: true,
                plan: true,
              },
            },
          },
        },
      },
    });

    if (!task) {
      throw new Error(
        'Invalid taskId!, there is no such task which has give taskId',
      );
    }

    if (task.status === TaskStatus.Await) {
      throw new Error('Invalid task status, current Task is in progress');
    }

    if (task.status === TaskStatus.Stopped) {
      throw new Error('This task is stopped');
    }

    if (task.status === TaskStatus.Completed) {
      throw new Error('This task is completed');
    }

    const { success, message } = await this.performTask(task);

    await this.tasksService.updateMany([
      {
        id: task.id,
        status: success ? TaskStatus.Await : TaskStatus.Failed,
        logs: [
          ...task.logs,
          JSON.stringify({
            timestamp: Date.now(),
            message,
          }),
        ],
      },
    ]);

    return true;
  }

  private async performAvailableTasksByUser(userId: string) {
    try {
      await this.logger.log({
        severity: 'Info',
        summary: `TaskExecutorService>performAvailableTasksByUser`,
      });

      const allTasks = await this.prismaService.task.findMany({
        where: {
          status: {
            notIn: [TaskStatus.Stopped, TaskStatus.Completed],
          },
          mission: {
            status: {
              notIn: [MissionStatus.Closed, MissionStatus.Ignored],
            },
            mode: MissionMode.Default,
            bot: {
              plan: {
                userId,
              },
            },
          },
        },
        include: {
          action: true,
          followerActions: {
            include: {
              action: true,
            },
          },
          mission: {
            include: {
              bot: {
                include: {
                  follower: true,
                  strategy: true,
                  followerContract: true,
                  leaderContract: true,
                  plan: true,
                },
              },
            },
          },
        },
      });

      const allTasksByBotMap = new Map<
        string,
        Map<number, Map<number, TaskBackwardDetails[]>>
      >();
      const awaitBotsMap = new Map<number, boolean>();

      allTasks.forEach((task) => {
        if (task.status === TaskStatus.Await) {
          awaitBotsMap.set(task.mission.botId, true);
        }

        let botMap = allTasksByBotMap.get(
          task.mission.bot.followerAddress.toLowerCase(),
        );

        if (!botMap) {
          botMap = new Map<number, Map<number, TaskBackwardDetails[]>>();
          allTasksByBotMap.set(
            task.mission.bot.followerAddress.toLowerCase(),
            botMap,
          );
        }

        const tasksByMissionMap = botMap.get(task.mission.botId);

        if (tasksByMissionMap) {
          const arr = tasksByMissionMap.get(task.missionId);

          if (arr) {
            arr.push(task);
          } else {
            tasksByMissionMap.set(task.missionId, [task]);
          }
        } else {
          const tempMap = new Map<number, TaskBackwardDetails[]>();
          tempMap.set(task.missionId, [task]);
          botMap.set(task.mission.botId, tempMap);
        }
      });

      const taskUpdateInputs: TaskUpdateInput[] = [];

      const promises = Array.from(allTasksByBotMap.values()).map(
        async (botMap) => {
          for (const [botId, tasksByMissionMap] of botMap.entries()) {
            if (awaitBotsMap.get(botId)) {
              continue;
            }

            let botTask: TaskBackwardDetails | null = null;

            for (const tasks of tasksByMissionMap.values()) {
              if (botTask) {
                break;
              }

              if (tasks.length === 0) {
                continue;
              }

              const sortedTasks = tasks.sort((a, b) => {
                if (a.action.blockNumber !== b.action.blockNumber) {
                  return a.action.blockNumber - b.action.blockNumber;
                }

                return a.action.orderInBlock - b.action.orderInBlock;
              });

              // find first create task and put it to queue
              for (let i = 0; i < sortedTasks.length; i++) {
                const task = sortedTasks[i];

                if (task.status === TaskStatus.Created) {
                  botTask = task;
                }

                break;
              }
            }

            if (botTask) {
              const { success, message } = await this.performTask(botTask);

              taskUpdateInputs.push({
                id: botTask.id,
                status:
                  success === 'success'
                    ? TaskStatus.Await
                    : success === 'skipped'
                      ? TaskStatus.Stopped
                      : TaskStatus.Failed,
                logs: [
                  ...botTask.logs,
                  JSON.stringify({
                    timestamp: Date.now(),
                    message,
                  }),
                ],
              });
            }
          }
        },
      );

      await Promise.allSettled(promises);

      await this.tasksService.updateMany(taskUpdateInputs);
    } catch (err) {
      await this.logger.log({
        severity: 'Error',
        summary: 'TaskExecutorService>performAvailableTasksByUser',
        details: getReadableError(err),
      });
    }
  }

  async handleFailedTasks() {
    try {
      await this.logger.log({
        severity: 'Info',
        summary: 'TaskExecutorService>handleFailedTasks',
      });

      const allFailedTasks = await this.prismaService.task.findMany({
        where: {
          status: TaskStatus.Failed,
          mission: {
            status: {
              notIn: [MissionStatus.Closed, MissionStatus.Ignored],
            },
          },
        },
        include: {
          action: true,
          followerActions: {
            include: {
              action: true,
            },
          },
          mission: {
            include: {
              bot: {
                include: {
                  followerContract: true,
                  leaderContract: true,
                },
              },
            },
          },
        },
      });

      for (const task of allFailedTasks) {
        if (
          task.action.name !== CloseMissionAction &&
          !getWeb3Info(
            task.mission.bot.followerContract.platform,
            task.mission.bot.followerContract.version,
          ).isCloseMissionAction(task.action)
        ) {
          // if task is created in the last 10 minutes, skip it
          if (dayjs().diff(dayjs(task.createdAt), 'minutes') < 10) {
            continue;
          }

          try {
            await this.tasksService.updateMany([
              {
                id: task.id,
                status: TaskStatus.Stopped,
                logs: [
                  ...task.logs,
                  JSON.stringify({
                    timestamp: Date.now(),
                    message: `Task stopped because it is awaiting for too long`,
                  }),
                ],
              },
            ]);
          } catch (err) {
            await this.logger.log({
              severity: 'Error',
              summary: `TaskExecutorService>handleFailedTasks>taskId: ${task.id}`,
              details: getReadableError(err),
            });
          }
        } else {
          try {
            await this.tasksService.closeMissionTasks(task.mission, false);
          } catch (err) {
            await this.logger.log({
              severity: 'Error',
              summary: `TaskExecutorService>handleFailedTasks>taskId: ${task.id}`,
              details: getReadableError(err),
            });
          }
        }
      }
    } catch (err) {
      await this.logger.log({
        severity: 'Error',
        summary: 'TaskExecutorService>handleFailedTasks',
        details: getReadableError(err),
      });
    }
  }

  async handleAwaitTasks() {
    try {
      await this.logger.log({
        severity: 'Info',
        summary: 'TaskExecutorService>handleAwaitTasks',
      });

      const allAwaitTasks = await this.prismaService.task.findMany({
        where: {
          status: TaskStatus.Await,
          mission: {
            status: {
              notIn: [MissionStatus.Closed, MissionStatus.Ignored],
            },
          },
        },
        include: {
          action: true,
          followerActions: {
            include: {
              action: true,
            },
          },
          mission: {
            include: {
              bot: {
                include: {
                  followerContract: true,
                  leaderContract: true,
                },
              },
            },
          },
        },
      });

      for (const task of allAwaitTasks) {
        // if task is created in the last 10 minutes, skip it
        if (dayjs().diff(dayjs(task.createdAt), 'minutes') < 10) {
          continue;
        }

        try {
          await this.tasksService.updateMany([
            {
              id: task.id,
              status: TaskStatus.Stopped,
              logs: [
                ...task.logs,
                JSON.stringify({
                  timestamp: Date.now(),
                  message: `Task stopped because it is awaiting for too long`,
                }),
              ],
            },
          ]);
        } catch (err) {
          await this.logger.log({
            severity: 'Error',
            summary: `TaskExecutorService>handleAwaitTasks>taskId: ${task.id}`,
            details: getReadableError(err),
          });
        }
      }
    } catch (err) {
      await this.logger.log({
        severity: 'Error',
        summary: 'TaskExecutorService>handleAwaitTasks',
        details: getReadableError(err),
      });
    }
  }

  async performAvailableTasks() {
    this.status = ServiceStatus.PROCESS;

    try {
      const allUsers = await this.prismaService.user.findMany({
        where: {
          permission: {
            in: [UserPermission.Admin, UserPermission.Trader],
          },
        },
      });

      for (const user of allUsers) {
        await this.performAvailableTasksByUser(user.address.toLowerCase());
      }
    } catch (err) {
      await this.logger.log({
        severity: 'Error',
        summary: `TaskExecutorService>performAvailableTasks`,
        details: getReadableError(err),
      });
    }

    this.status = ServiceStatus.READY;
  }
}
