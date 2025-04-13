import { Injectable } from '@nestjs/common';
import { Address } from 'viem';
import { MissionStatus, TaskStatus, UserPermission } from '@prisma/client';

import { PrismaService } from 'src/global/prisma.service';
import { TradeService } from 'src/global/trade.service';
import { TradingVariableService } from 'src/global/trading-variable.service';
import { ChainsService } from 'src/global/chains.service';
import { MissionsService } from 'src/missions/missions.service';
import { TasksService } from 'src/tasks/tasks.service';

import { tradeMaxClosingSlippagePUpdatedEventParser } from 'src/actions/eventParsers/trade-max-closing-slippage-p-updated.parser';
import { leverageUpdateExecutedEventParser } from 'src/actions/eventParsers/leverage-update-executed.parser';
import { positionSizeIncreaseExecutedEventParser } from 'src/actions/eventParsers/position-size-increase-executed.parser';
import { positionSizeDecreaseExecutedEventParser } from 'src/actions/eventParsers/position-size-decrease-executed.parser';

import {
  missionEventNames,
  isOpenMissionAction,
  isCloseMissionAction,
  missionEventParsers,
} from 'src/actions/eventParsers';

import { gnsMultiCollatDiamondAbi } from 'src/abi/GNSMultiCollatDiamond';
import {
  getOpenMissionParams,
  getPositionDecreaseParams,
  getPositionIncreaseParams,
} from 'src/strategy/strategy-library';
import { CloseMissionActionArgs, TradeType } from 'src/types';

import { TaskBackwardDetails } from 'src/tasks/entities/task.entity';

import { CloseMissionAction, USDCCollateralIndex } from 'src/utils/constants';

import { getReadableError } from 'src/utils';
import { FollowerService } from 'src/follower/follower.service';
import { LogsService } from 'src/loggers/logs.service';
import { TaskUpdateInput } from 'src/tasks/dto/task.input';

@Injectable()
export class TaskExecutorService {
  status: 'process' | 'ready' = 'ready';

  constructor(
    private prismaService: PrismaService,
    private chainsService: ChainsService,
    private followerService: FollowerService,
    private tradeService: TradeService,
    private tradingVariableService: TradingVariableService,
    private missionsService: MissionsService,
    private tasksService: TasksService,
    private readonly logger: LogsService,
  ) {}

  private async performTask(
    task: TaskBackwardDetails,
  ): Promise<{ success: boolean; message: string }> {
    try {
      const { action, mission } = task;
      const { bot, achievePosition } = mission;
      const { follower, followerContract, leaderContractId, strategy } = bot;

      if (
        task.status !== TaskStatus.Created &&
        task.status !== TaskStatus.Failed
      ) {
        throw new Error('Invalid task status');
      }

      if (!isOpenMissionAction(action) && !achievePosition) {
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

      const mnemonic = user.mnemonic;

      if (!mnemonic) {
        throw new Error('User does not have mnemonic');
      }

      const walletClient = this.chainsService.walletClient(
        mnemonic,
        followerContract.chainId,
        follower,
      );
      const publicClient = this.chainsService.publicClient(
        followerContract.chainId,
      );

      let tx: `0x${string}` | null = null;

      switch (action.name) {
        case tradeMaxClosingSlippagePUpdatedEventParser.eventName: {
          const { args } =
            tradeMaxClosingSlippagePUpdatedEventParser.actionParser(action);

          tx = await this.tradeService.updateMaxClosingSlippageP(
            walletClient,
            publicClient,
            followerContract.chainId,
            {
              index: achievePosition!.index,
              maxSlippageP: args.maxClosingSlippageP,
            },
          );

          break;
        }
        case leverageUpdateExecutedEventParser.eventName: {
          const { args } =
            leverageUpdateExecutedEventParser.actionParser(action);

          if (!args.isIncrease) {
            const followerTradeData = await publicClient.readContract({
              address: followerContract.address as Address,
              abi: gnsMultiCollatDiamondAbi,
              functionName: 'getTrade',
              args: [follower.address as Address, achievePosition!.index],
            });

            const collateralDelta =
              (BigInt(followerTradeData.collateralAmount) *
                BigInt(followerTradeData.leverage)) /
                BigInt(args.values.newLeverage) -
              BigInt(followerTradeData.collateralAmount);

            if (collateralDelta > 0n) {
              const result = await this.followerService.depositAsset(
                task.mission.bot.plan.userId,
                {
                  address: follower.address,
                  contract: followerContract,
                  amount: collateralDelta + collateralDelta / 100n,
                  kind: 'usdc',
                },
              );

              if (!result) {
                await this.logger.log({
                  severity: 'Error',
                  summary: 'TaskExecutorService>performTask',
                  details: `Failed at borrowing usdc from vault`,
                });

                return {
                  success: false,
                  message: `Failed at borrowing usdc from vault`,
                };
              }
            }
          }

          tx = await this.tradeService.updateLeverage(
            walletClient,
            publicClient,
            followerContract.chainId,
            {
              index: achievePosition!.index,
              newLeverage: Number(args.values.newLeverage),
            },
          );

          break;
        }
        case positionSizeIncreaseExecutedEventParser.eventName: {
          const { args } =
            positionSizeIncreaseExecutedEventParser.actionParser(action);

          const followerTradeData = await publicClient.readContract({
            address: followerContract.address as Address,
            abi: gnsMultiCollatDiamondAbi,
            functionName: 'getTrade',
            args: [follower.address as Address, achievePosition!.index],
          });

          const increaseParams = getPositionIncreaseParams(
            strategy,
            args,
            followerTradeData,
          );

          if (increaseParams.collateralDelta > 0n) {
            // if new position size is less than 0.5% of the old position size, skip the update
            if (
              increaseParams.collateralDelta *
                BigInt(increaseParams.leverageDelta) <
              (followerTradeData.collateralAmount * 5n) / 1000n
            ) {
              return {
                success: true,
                message: `Skipped this position size update because collateral delta is too small`,
              };
            }

            const result = await this.followerService.depositAsset(
              task.mission.bot.plan.userId,
              {
                address: follower.address,
                contract: followerContract,
                amount: increaseParams.collateralDelta,
                kind: 'usdc',
              },
            );

            if (!result) {
              await this.logger.log({
                severity: 'Error',
                summary: 'TaskExecutorService>performTask',
                details: `Failed at borrowing usdc from vault`,
              });

              return {
                success: false,
                message: `Failed at borrowing usdc from vault`,
              };
            }
          }

          tx = await this.tradeService.increasePositionSize(
            walletClient,
            publicClient,
            followerContract.chainId,
            {
              ...increaseParams,
              index: achievePosition!.index,
              maxSlippageP: 1000,
            },
          );

          break;
        }
        case positionSizeDecreaseExecutedEventParser.eventName: {
          const { args } =
            positionSizeDecreaseExecutedEventParser.actionParser(action);

          const followerTradeData = await publicClient.readContract({
            address: followerContract.address as Address,
            abi: gnsMultiCollatDiamondAbi,
            functionName: 'getTrade',
            args: [follower.address as Address, achievePosition!.index],
          });

          tx = await this.tradeService.decreasePositionSize(
            walletClient,
            publicClient,
            followerContract.chainId,
            {
              ...getPositionDecreaseParams(strategy, args, followerTradeData),
              index: achievePosition!.index,
            },
          );

          if (tx) {
            const transaction = await publicClient.waitForTransactionReceipt({
              hash: tx as `0x${string}`,
            });

            if (transaction.status === 'success') {
              await this.followerService.withdrawAllUSDC(
                task.mission.bot.plan.userId,
                follower.address,
                followerContract.id,
              );

              return {
                success: true,
                message: `Task achieved`,
              };
            } else {
              await this.logger.log({
                severity: 'Error',
                summary: 'TaskExecutorService>performTask',
                details: JSON.stringify(transaction.logs, (_, v) =>
                  typeof v === 'bigint' ? v.toString() : v,
                ),
              });

              return {
                success: false,
                message: JSON.stringify(transaction.logs, (_, v) =>
                  typeof v === 'bigint' ? v.toString() : v,
                ),
              };
            }
          }

          break;
        }
        case CloseMissionAction: {
          const args = JSON.parse(action.args) as CloseMissionActionArgs;

          tx = await this.tradeService.closeTradeMarket(
            walletClient,
            publicClient,
            followerContract.chainId,
            {
              index: achievePosition!.index,
              expectedPrice: BigInt(args.expectedPrice),
            },
          );

          if (tx) {
            const transaction = await publicClient.waitForTransactionReceipt({
              hash: tx as `0x${string}`,
            });

            if (transaction.status === 'success') {
              await this.followerService.withdrawAllUSDC(
                task.mission.bot.plan.userId,
                follower.address,
                followerContract.id,
              );

              return {
                success: true,
                message: `Task achieved`,
              };
            } else {
              await this.logger.log({
                severity: 'Error',
                summary: 'TaskExecutorService>performTask',
                details: JSON.stringify(transaction.logs, (_, v) =>
                  typeof v === 'bigint' ? v.toString() : v,
                ),
              });

              return {
                success: false,
                message: JSON.stringify(transaction.logs, (_, v) =>
                  typeof v === 'bigint' ? v.toString() : v,
                ),
              };
            }
          }

          break;
        }
        default: {
          if (missionEventNames.includes(action.name)) {
            const event = missionEventParsers
              .find((parser) => parser.eventName === action.name)!
              .actionParser(action);
            const { t, collateralPriceUsd } = event.args;

            const pair = this.tradingVariableService.getPair(
              followerContract.id,
              t.pairIndex,
            );

            if (!pair) {
              await this.missionsService.closeMany([{ id: mission.id }]);

              throw new Error(
                `follower contract doesn't support this pairIndex: ${t.pairIndex}`,
              );
            }

            const collateral = this.tradingVariableService.getCollateral(
              leaderContractId,
              t.collateralIndex,
            );
            const usdcPrice =
              await this.tradingVariableService.getCollateralPrice(
                followerContract,
                USDCCollateralIndex[
                  followerContract.chainId as keyof typeof USDCCollateralIndex
                ],
              );

            if (isOpenMissionAction(action)) {
              const openMissionParams = getOpenMissionParams(
                strategy,
                {
                  leverage: t.leverage,
                  collateralAmount: BigInt(t.collateralAmount),
                  collateralPriceUsd: BigInt(collateralPriceUsd),
                  collateral,
                },
                bot.leaderCollateralBaseline,
                usdcPrice,
              );

              if (openMissionParams.collateralAmount > 0n) {
                const result = await this.followerService.depositAsset(
                  task.mission.bot.plan.userId,
                  {
                    address: follower.address,
                    contract: followerContract,
                    amount: openMissionParams.collateralAmount,
                    kind: 'usdc',
                  },
                );

                if (!result) {
                  await this.logger.log({
                    severity: 'Error',
                    summary: 'TaskExecutorService>performTask',
                    details: 'Failed at borrowing usdc from vault',
                  });

                  return {
                    success: false,
                    message: `Failed at borrowing usdc from vault`,
                  };
                }
              }

              tx = await this.tradeService.openTrade(
                walletClient,
                publicClient,
                followerContract.chainId,
                {
                  trade: {
                    ...openMissionParams,
                    user: follower.address as Address,
                    index: 0,
                    pairIndex: t.pairIndex,
                    long: t.long,
                    isOpen: true,
                    collateralIndex:
                      USDCCollateralIndex[
                        followerContract.chainId as keyof typeof USDCCollateralIndex
                      ],
                    tradeType: TradeType.TRADE,
                    openPrice: BigInt(t.openPrice),
                    tp: 0n,
                    sl: 0n,
                    __placeholder: BigInt(t.__placeholder),
                  },
                  maxSlippageP: 1000,
                },
              );
            }

            if (isCloseMissionAction(action)) {
              tx = await this.tradeService.closeTradeMarket(
                walletClient,
                publicClient,
                followerContract.chainId,
                {
                  index: achievePosition!.index,
                  expectedPrice: BigInt(t.openPrice),
                },
              );

              if (tx) {
                const transaction =
                  await publicClient.waitForTransactionReceipt({
                    hash: tx as `0x${string}`,
                  });

                if (transaction.status === 'success') {
                  await this.followerService.withdrawAllUSDC(
                    task.mission.bot.plan.userId,
                    follower.address,
                    followerContract.id,
                  );

                  return {
                    success: true,
                    message: `Task achieved`,
                  };
                } else {
                  await this.logger.log({
                    severity: 'Error',
                    summary: 'TaskExecutorService>performTask',
                    details: JSON.stringify(transaction.logs, (_, v) =>
                      typeof v === 'bigint' ? v.toString() : v,
                    ),
                  });

                  return {
                    success: false,
                    message: JSON.stringify(transaction.logs, (_, v) =>
                      typeof v === 'bigint' ? v.toString() : v,
                    ),
                  };
                }
              }
            }
          }

          break;
        }
      }

      if (tx) {
        const transaction = await publicClient.waitForTransactionReceipt({
          hash: tx as `0x${string}`,
        });

        if (transaction.status === 'success') {
          return {
            success: true,
            message: `Task achieved`,
          };
        } else {
          await this.logger.log({
            severity: 'Error',
            summary: 'TaskExecutorService>performTask',
            details: JSON.stringify(transaction.logs, (_, v) =>
              typeof v === 'bigint' ? v.toString() : v,
            ),
          });

          return {
            success: false,
            message: JSON.stringify(transaction.logs, (_, v) =>
              typeof v === 'bigint' ? v.toString() : v,
            ),
          };
        }
      } else {
        throw new Error('Error at waiting for transaction receipt');
      }
    } catch (err) {
      await this.logger.log({
        severity: 'Error',
        summary: 'TaskExecutorService>performTask',
        details: getReadableError(err),
      });

      return {
        success: false,
        message: getReadableError(err),
      };
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
            targetPosition: true,
            achievePosition: true,
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
        summary: 'TaskExecutorService>performAvailableTasks',
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
              achievePosition: true,
              targetPosition: true,
            },
          },
        },
      });

      const allTasksByBotMap = new Map<
        number,
        Map<number, TaskBackwardDetails[]>
      >();
      const awaitBotsMap = new Map<number, boolean>();

      allTasks.forEach((task) => {
        if (task.status === TaskStatus.Await) {
          awaitBotsMap.set(task.mission.botId, true);
        }

        const tasksByMissionMap = allTasksByBotMap.get(task.mission.botId);

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
          allTasksByBotMap.set(task.mission.botId, tempMap);
        }
      });

      const taskUpdateInputs: TaskUpdateInput[] = [];

      for (const [botId, tasksByMissionMap] of allTasksByBotMap.entries()) {
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
            ...botTask,
            status: success ? TaskStatus.Await : TaskStatus.Failed,
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

      await this.tasksService.updateMany(taskUpdateInputs);
    } catch (err) {
      await this.logger.log({
        severity: 'Error',
        summary: 'TaskExecutorService>performAvailableTasks',
        details: getReadableError(err),
      });
    }
  }

  async performAvailableTasks() {
    this.status = 'process';

    try {
      await this.logger.log({
        severity: 'Info',
        summary: 'TaskExecutorService>performAvailableTasks',
      });

      const allUsers = await this.prismaService.user.findMany({
        where: {
          permission: {
            in: [UserPermission.Admin, UserPermission.Trader],
          },
        },
      });

      const promises = allUsers.map(async (user) => {
        await this.performAvailableTasksByUser(user.address.toLowerCase());
      });

      await Promise.allSettled(promises);
    } catch (err) {
      await this.logger.log({
        severity: 'Error',
        summary: 'TaskExecutorService>performAvailableTasks',
        details: getReadableError(err),
      });
    }

    this.status = 'ready';
  }
}
