import { Injectable } from '@nestjs/common';
import { Address, decodeEventLog } from 'viem';
import { MissionStatus, TaskStatus, UserPermission } from '@prisma/client';

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

import {
  eventParsers,
  missionEventNames,
  isOpenMissionAction,
  isCloseMissionAction,
  missionEventParsers,
  eventToActionParser,
} from 'src/web3/platform/gns/v10/eventParsers';

import { gnsMultiCollatDiamondAbi } from 'src/web3/platform/gns/v10/abi/GNSMultiCollatDiamond';
import {
  getOpenMissionParams,
  getPositionDecreaseParams,
  getPositionIncreaseParams,
} from 'src/microservices/apiService/modules/strategy/strategy-library';
import { ChainPriority, CloseMissionActionArgs } from 'src/types';
import { TradeType } from 'src/web3/platform/gns/v10/types';

import { TaskBackwardDetails } from 'src/microservices/apiService/modules/tasks/entities/task.entity';

import { CloseMissionAction, USDCCollateralIndex } from 'src/utils/constants';

import { getReadableError } from 'src/utils';

import { TaskUpdateInput } from 'src/microservices/apiService/modules/tasks/dto/task.input';

import { MIN_FEE } from 'src/utils/constants';
import { marketOrderInitiatedEventParser } from 'src/web3/platform/gns/v10/eventParsers/market-order-initiated.parser';
import { ServiceStatus } from 'src/types';

const expectedEventSignatures: Record<string, string> = Object.fromEntries(
  gnsMultiCollatDiamondAbi
    .filter((item) => item.type === 'event')
    .map((item) => [item.signature, item.name]),
);

@Injectable()
export class TaskExecutorService {
  status: ServiceStatus = ServiceStatus.READY;
  readonly registeredEventNames: string[] = [];

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
    this.registeredEventNames = eventParsers.map((item) => item.eventName);
    this.status = ServiceStatus.READY;
  }

  private async performTask(
    task: TaskBackwardDetails,
  ): Promise<{ success: boolean; message: string }> {
    let tx: `0x${string}` | null = null;

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

      const mnemonic = await this.followerService.getMnemonic(
        user.mnemonic || '',
      );

      switch (action.name) {
        case tradeMaxClosingSlippagePUpdatedEventParser.eventName: {
          const { args } =
            tradeMaxClosingSlippagePUpdatedEventParser.actionParser(action);

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

          if (!args.isIncrease) {
            const followerTradeData = await this.gnsService.getTrade({
              contractId: followerContract.id,
              priority: ChainPriority.HIGH,
              args: {
                address: follower.address as Address,
                index: achievePosition!.index,
              },
            });

            const collateralDelta = BigInt(
              Math.floor(
                (Number(followerTradeData.collateralAmount) *
                  Number(followerTradeData.leverage)) /
                  Number(args.values.newLeverage) -
                  Number(followerTradeData.collateralAmount),
              ),
            );

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

          tx = await this.gnsService.updateLeverage({
            mnemonic,
            accountIndex: follower.accountIndex,
            contractId: followerContract.id,
            args: {
              index: achievePosition!.index,
              newLeverage: Number(args.values.newLeverage),
            },
          });

          break;
        }
        case positionSizeIncreaseExecutedEventParser.eventName: {
          const { args } =
            positionSizeIncreaseExecutedEventParser.actionParser(action);

          const followerTradeData = await this.gnsService.getTrade({
            contractId: followerContract.id,
            priority: ChainPriority.HIGH,
            args: {
              address: follower.address as Address,
              index: achievePosition!.index,
            },
          });

          const collateral = this.gnsService.getCollateral(
            leaderContractId,
            args.collateralIndex,
          );

          const increaseParams = getPositionIncreaseParams(
            strategy,
            args,
            collateral,
            followerTradeData,
          );

          if (increaseParams === null) {
            return {
              success: true,
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

          tx = await this.gnsService.increasePositionSize({
            mnemonic,
            accountIndex: follower.accountIndex,
            contractId: followerContract.id,
            args: {
              ...increaseParams,
              index: achievePosition!.index,
              maxSlippageP: 1000,
            },
          });

          break;
        }
        case positionSizeDecreaseExecutedEventParser.eventName: {
          const { args } =
            positionSizeDecreaseExecutedEventParser.actionParser(action);

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
            args,
            followerTradeData,
          );

          if (decreaseParams === null) {
            return {
              success: true,
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
            const transaction =
              await this.evmAdapterService.waitForTransactionReceipt({
                hash: tx as `0x${string}`,
                priority: ChainPriority.HIGH,
                chainId: followerContract.chainId,
                confirmations: 1,
              });

            if (transaction.status === 'success') {
              await this.followerService.withdrawAllUSDC(
                task.mission.bot.plan.userId,
                follower.address,
                followerContract.id,
              );

              return {
                success: true,
                message: `Task achieved tx: ${tx}`,
              };
            } else {
              await this.logger.log({
                severity: 'Error',
                summary: 'TaskExecutorService>performTask',
                details:
                  JSON.stringify(transaction.logs, (_, v) =>
                    typeof v === 'bigint' ? v.toString() : v,
                  ) + ` tx: ${tx}`,
              });

              return {
                success: false,
                message:
                  JSON.stringify(transaction.logs, (_, v) =>
                    typeof v === 'bigint' ? v.toString() : v,
                  ) + ` tx: ${tx}`,
              };
            }
          }

          break;
        }
        case CloseMissionAction: {
          const args = JSON.parse(action.args) as CloseMissionActionArgs;

          tx = await this.gnsService.closeTradeMarket({
            mnemonic,
            accountIndex: follower.accountIndex,
            contractId: followerContract.id,
            args: {
              index: achievePosition!.index,
              expectedPrice: BigInt(args.expectedPrice),
            },
          });

          if (tx) {
            const transaction =
              await this.evmAdapterService.waitForTransactionReceipt({
                hash: tx as `0x${string}`,
                priority: ChainPriority.HIGH,
                chainId: followerContract.chainId,
                confirmations: 1,
              });

            if (transaction.status === 'success') {
              await this.followerService.withdrawAllUSDC(
                task.mission.bot.plan.userId,
                follower.address,
                followerContract.id,
              );

              return {
                success: true,
                message: `Task achieved tx: ${tx}`,
              };
            } else {
              await this.logger.log({
                severity: 'Error',
                summary: 'TaskExecutorService>performTask',
                details:
                  JSON.stringify(transaction.logs, (_, v) =>
                    typeof v === 'bigint' ? v.toString() : v,
                  ) + ` tx: ${tx}`,
              });

              return {
                success: false,
                message:
                  JSON.stringify(transaction.logs, (_, v) =>
                    typeof v === 'bigint' ? v.toString() : v,
                  ) + ` tx: ${tx}`,
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
            const { t, collateralPriceUsd, isManualOpen } = event.args;

            const pair = this.gnsService.getPair(
              followerContract.id,
              t.pairIndex,
            );

            if (!pair) {
              await this.missionsService.closeMany(
                [{ id: mission.id }],
                new Map(),
              );

              throw new Error(
                `follower contract doesn't support this pairIndex: ${t.pairIndex}`,
              );
            }

            const collateral = this.gnsService.getCollateral(
              leaderContractId,
              t.collateralIndex,
            );
            const usdcPrice = await this.gnsService.getCollateralPrice({
              contractId: followerContract.id,
              priority: ChainPriority.HIGH,
              args: {
                collateralIndex:
                  USDCCollateralIndex[
                    followerContract.chainId as keyof typeof USDCCollateralIndex
                  ],
              },
            });

            if (isOpenMissionAction(action)) {
              const openMissionParams = isManualOpen
                ? {
                    collateralAmount: BigInt(t.collateralAmount),
                    leverage: t.leverage,
                  }
                : getOpenMissionParams(
                    strategy,
                    {
                      leverage: t.leverage,
                      collateralAmount: BigInt(t.collateralAmount),
                      collateralPriceUsd: BigInt(collateralPriceUsd),
                      collateral,
                    },
                    bot.leaderCollateralBaseline,
                    usdcPrice,
                    t.pairIndex,
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

              tx = await this.gnsService.openTrade({
                mnemonic,
                accountIndex: follower.accountIndex,
                contractId: followerContract.id,
                args: {
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
                    isCounterTrade: false,
                    positionSizeToken: 0n,
                    __placeholder: Number(t.__placeholder),
                  },
                  maxSlippageP: 1000,
                },
              });

              await this.handleOpenTradeTransaction(task, tx);
            }

            if (isCloseMissionAction(action)) {
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
                const transaction =
                  await this.evmAdapterService.waitForTransactionReceipt({
                    hash: tx as `0x${string}`,
                    priority: ChainPriority.HIGH,
                    chainId: followerContract.chainId,
                    confirmations: 1,
                  });

                if (transaction.status === 'success') {
                  await this.followerService.withdrawAllUSDC(
                    task.mission.bot.plan.userId,
                    follower.address,
                    followerContract.id,
                  );

                  return {
                    success: true,
                    message: `Task achieved tx: ${tx}`,
                  };
                } else {
                  await this.logger.log({
                    severity: 'Error',
                    summary: 'TaskExecutorService>performTask',
                    details:
                      JSON.stringify(transaction.logs, (_, v) =>
                        typeof v === 'bigint' ? v.toString() : v,
                      ) + ` tx: ${tx}`,
                  });

                  return {
                    success: false,
                    message:
                      JSON.stringify(transaction.logs, (_, v) =>
                        typeof v === 'bigint' ? v.toString() : v,
                      ) + ` tx: ${tx}`,
                  };
                }
              }
            }
          }

          break;
        }
      }

      if (tx) {
        await this.logger.log({
          severity: 'Info',
          summary: 'TaskExecutorService>performTask',
          details: `tx: ${tx}`,
        });

        const transaction =
          await this.evmAdapterService.waitForTransactionReceipt({
            hash: tx as `0x${string}`,
            priority: ChainPriority.HIGH,
            chainId: followerContract.chainId,
            confirmations: 1,
          });

        if (transaction.status === 'success') {
          return {
            success: true,
            message: `Task achieved tx: ${tx}`,
          };
        } else {
          await this.logger.log({
            severity: 'Error',
            summary: 'TaskExecutorService>performTask',
            details:
              JSON.stringify(transaction.logs, (_, v) =>
                typeof v === 'bigint' ? v.toString() : v,
              ) + ` tx: ${tx}`,
          });

          return {
            success: false,
            message:
              JSON.stringify(transaction.logs, (_, v) =>
                typeof v === 'bigint' ? v.toString() : v,
              ) + ` tx: ${tx}`,
          };
        }
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
        success: false,
        message: getReadableError(err) + ` tx: ${tx}`,
      };
    }
  }

  private async handleOpenTradeTransaction(
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
        this.registeredEventNames.includes(
          expectedEventSignatures[log.topics[0] as string],
        )
      ) {
        const parsed = eventToActionParser(
          bot.followerContractId,
          decodeEventLog({
            abi: gnsMultiCollatDiamondAbi,
            data: log.data,
            topics: log.topics,
          }),
        );

        if (parsed.name === marketOrderInitiatedEventParser.eventName) {
          const { args } = marketOrderInitiatedEventParser.actionParser(parsed);

          if (!args.open) {
            continue;
          }

          const actions = await this.actionsService.createMany(
            bot.followerContractId,
            [
              {
                name: parsed.name,
                positionAddress: args.orderId.user.toLowerCase(),
                positionIndex: args.orderId.index,
                args: parsed.args,
                blockNumber: Number(log.blockNumber),
                orderInBlock: 0,
              },
            ],
          );

          if (actions.length === 0) {
            continue;
          }

          await this.missionsService.attachAchievePositionMany(
            [
              {
                id: mission.id,
                achievePositionId: actions[0].positionId,
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
        summary: 'TaskExecutorService>performAvailableTasksByUser',
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
            id: botTask.id,
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
          mission: true,
        },
      });

      for (const task of allFailedTasks) {
        if (
          task.action.name !== CloseMissionAction &&
          !missionEventNames.includes(task.action.name) &&
          !isCloseMissionAction(task.action)
        ) {
          continue;
        }

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
    } catch (err) {
      await this.logger.log({
        severity: 'Error',
        summary: 'TaskExecutorService>handleFailedTasks',
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
        summary: 'TaskExecutorService>performAvailableTasks',
        details: getReadableError(err),
      });
    }

    this.status = ServiceStatus.READY;
  }
}
