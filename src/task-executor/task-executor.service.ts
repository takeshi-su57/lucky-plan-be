import { Injectable, Logger } from '@nestjs/common';
import { Address } from 'viem';
import { TaskStatus } from '@prisma/client';

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

import { TaskDetails } from 'src/tasks/entities/task.entity';

import { CloseMissionAction, USDCCollateralIndex } from 'src/utils/constants';

import { getReadableError } from 'src/utils';

@Injectable()
export class TaskExecutorService {
  status: 'process' | 'ready' = 'process';

  constructor(
    private prismaService: PrismaService,
    private chainsService: ChainsService,
    private tradeService: TradeService,
    private tradingVariableService: TradingVariableService,
    private missionsService: MissionsService,
    private tasksService: TasksService,
    private readonly logger: Logger,
  ) {}

  private async performTask(
    task: TaskDetails,
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

      const walletClient = this.chainsService.walletClient(
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

          tx = await this.tradeService.increasePositionSize(
            walletClient,
            publicClient,
            followerContract.chainId,
            {
              ...getPositionIncreaseParams(strategy, args, followerTradeData),
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
              tx = await this.tradeService.openTrade(
                walletClient,
                publicClient,
                followerContract.chainId,
                {
                  trade: {
                    ...getOpenMissionParams(
                      strategy,
                      {
                        leverage: t.leverage,
                        collateralAmount: BigInt(t.collateralAmount),
                        collateralPriceUsd: BigInt(collateralPriceUsd),
                        collateral,
                      },
                      bot.leaderCollateralBaseline,
                      usdcPrice,
                    ),
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
      this.logger.log(err);

      return {
        success: false,
        message: getReadableError(err),
      };
    }
  }

  async performTaskById(taskId: number) {
    const task = await this.prismaService.task.findUnique({
      where: {
        id: taskId,
      },
      include: {
        action: true,
        mission: {
          include: {
            bot: {
              include: {
                follower: true,
                leader: true,
                strategy: true,
                followerContract: true,
                leaderContract: true,
              },
            },
            achievePosition: true,
            targetPosition: true,
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

    return task;
  }

  async performAvailableTasks() {
    this.status = 'process';

    try {
      const allTasks = await this.prismaService.task.findMany({
        where: {
          status: {
            notIn: [TaskStatus.Stopped, TaskStatus.Completed],
          },
        },
        include: {
          action: true,
          mission: {
            include: {
              bot: {
                include: {
                  follower: true,
                  leader: true,
                  strategy: true,
                  followerContract: true,
                  leaderContract: true,
                },
              },
              achievePosition: true,
              targetPosition: true,
            },
          },
        },
      });

      const allTasksByBotMap = new Map<number, Map<number, TaskDetails[]>>();

      allTasks.forEach((task) => {
        const tasksByMissionMap = allTasksByBotMap.get(task.mission.botId);

        if (tasksByMissionMap) {
          const arr = tasksByMissionMap.get(task.missionId);

          if (arr) {
            arr.push(task);
          } else {
            tasksByMissionMap.set(task.missionId, [task]);
          }
        } else {
          const tempMap = new Map<number, TaskDetails[]>();
          tempMap.set(task.missionId, [task]);
          allTasksByBotMap.set(task.mission.botId, tempMap);
        }
      });

      const botTasks: TaskDetails[] = [];

      for (const tasksByMissionMap of allTasksByBotMap.values()) {
        const openMissionTasks: {
          created: TaskDetails[];
          await: TaskDetails[];
        } = { created: [], await: [] };

        for (const tasks of tasksByMissionMap.values()) {
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

            if (task.status === TaskStatus.Completed) {
              continue;
            }

            if (
              task.status === TaskStatus.Await &&
              isOpenMissionAction(task.action)
            ) {
              openMissionTasks.await.push(sortedTasks[0]);
            }

            if (task.status === TaskStatus.Created) {
              if (isOpenMissionAction(task.action)) {
                openMissionTasks.created.push(sortedTasks[0]);
              } else {
                botTasks.push(task);
              }
            }

            break;
          }
        }

        // there is a pending opening mission task. need to wait more
        if (openMissionTasks.await.length > 0) {
          continue;
        }

        if (openMissionTasks.created.length > 0) {
          botTasks.push(...openMissionTasks.created);
        }
      }

      const promises = botTasks.map(async (task) => {
        const { success, message } = await this.performTask(task);

        return {
          ...task,
          status: success ? TaskStatus.Await : TaskStatus.Failed,
          logs: [
            ...task.logs,
            JSON.stringify({
              timestamp: Date.now(),
              message,
            }),
          ],
        };
      });

      const updatedTasks = await Promise.allSettled(promises);

      await this.tasksService.updateMany(
        updatedTasks
          .filter((result) => result.status === 'fulfilled')
          .map((result) => ({
            id: result.value.id,
            status: result.value.status,
            logs: result.value.logs,
          })),
      );
    } catch (err) {
      this.logger.error('Error at task perform', err);
    }

    this.status = 'ready';
  }
}
