import { Inject, Injectable, Logger } from '@nestjs/common';
import { TaskStatus } from '@prisma/client';
import { Address } from 'viem';
import { PubSub } from 'graphql-subscriptions';

import {
  missionEventNames,
  missionCanceledEventNames,
  updateEventNames,
  isOpenMissionAction,
  isCloseMissionAction,
  isSameUpdateAction,
  missionEventParsers,
} from 'src/actions/eventParsers';

import { PrismaService } from 'src/global/prisma.service';

import {
  ActionContext,
  CancelReason,
  CloseMissionActionArgs,
  MissionContext,
  TradeType,
} from 'src/types';
import { TaskDetails, TaskShallowDetails } from './entities/task.entity';
import { TaskCreateInput, TaskUpdateInput } from './dto/task.input';

import { marketOrderInitiatedEventParser } from 'src/actions/eventParsers/market-order-initiated.parser';
import { marketOpenCanceledEventParser } from 'src/actions/eventParsers/market-open-canceled';
import { Action } from 'src/actions/entities/action.entity';

import { CreateFollowerActionInput } from 'src/follower-actions/dto/follower-action.input';
import { FollowerActionsService } from 'src/follower-actions/follower-actions.service';
import { ChainsService } from 'src/global/chains.service';
import { TradeService } from 'src/global/trade.service';
import { tradeMaxClosingSlippagePUpdatedEventParser } from 'src/actions/eventParsers/trade-max-closing-slippage-p-updated.parser';
import { leverageUpdateExecutedEventParser } from 'src/actions/eventParsers/leverage-update-executed.parser';
import { positionSizeIncreaseExecutedEventParser } from 'src/actions/eventParsers/position-size-increase-executed.parser';
import { positionSizeDecreaseExecutedEventParser } from 'src/actions/eventParsers/position-size-decrease-executed.parser';

import {
  CloseMissionAction,
  SUBSCRIPTION_TOKEN,
  USDCCollateralIndex,
} from 'src/utils/constants';
import { TradingVariableService } from 'src/global/trading-variable.service';
import { getReadableError } from 'src/utils';
import { ActionsService } from 'src/actions/actions.service';
import { Mission } from 'src/missions/entities/mission.entity';
import { PUB_SUB } from 'src/global/global.module';
import { gnsMultiCollatDiamondAbi } from 'src/abi/GNSMultiCollatDiamond';
import {
  getOpenMissionParams,
  getPositionDecreaseParams,
  getPositionIncreaseParams,
} from 'src/strategy/strategy-library';

@Injectable()
export class TasksService {
  // Map<botId, Map<missionId, TaskDetails[]>>
  private tasksByBotMap = new Map<number, Map<number, TaskShallowDetails[]>>();
  status: 'process' | 'ready';

  constructor(
    @Inject(PUB_SUB) private readonly pubSub: PubSub,
    private prismaService: PrismaService,
    private chainsService: ChainsService,
    private tradeService: TradeService,
    private tradingVariableService: TradingVariableService,
    private followerActionsService: FollowerActionsService,
    private actionsService: ActionsService,
    private readonly logger: Logger,
  ) {
    this.status = 'ready';
    this.loadTasks();
  }

  private async performTask(
    task: TaskDetails,
  ): Promise<{ success: boolean; message: string }> {
    try {
      const { action, mission } = task;
      const { bot, achievePosition } = mission;
      const { follower, followerContract, strategy } = bot;

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

          if (args.cancelReason !== CancelReason.NONE) {
            throw new Error('Leverage Update Executed Event has canceled');
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

          if (args.cancelReason !== CancelReason.NONE) {
            throw new Error(
              'Position Size Increase Executed Event has canceled',
            );
          }

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

          if (args.cancelReason !== CancelReason.NONE) {
            throw new Error(
              'Position Size Decrease Executed Event has canceled',
            );
          }

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
            const usdcCollateral =
              this.tradingVariableService.getCollateral(USDCCollateralIndex);

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
                      },
                      usdcCollateral.usdPrice,
                    ),
                    user: follower.address as Address,
                    index: 0,
                    pairIndex: t.pairIndex,
                    long: t.long,
                    isOpen: true,
                    collateralIndex: USDCCollateralIndex,
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
      console.log(err);
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
        'Invalid bot id!, there is no such task which has give bot id',
      );
    }

    const { success, message } = await this.performTask(task);

    await this.updateMany([
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

      await this.updateMany(
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

  async closeMissionTasks(mission: Mission): Promise<boolean> {
    const allMissionTasks = await this.prismaService.task.findMany({
      where: {
        missionId: mission.id,
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

    if (allMissionTasks.length === 0) {
      return false;
    }

    const sortedMissionTasks = allMissionTasks.sort((a, b) => {
      if (a.action.blockNumber !== b.action.blockNumber) {
        return a.action.blockNumber - b.action.blockNumber;
      }

      return a.action.orderInBlock - b.action.orderInBlock;
    });

    let openTask: TaskDetails | null = null;
    const awaitingTasks: TaskDetails[] = [];
    const createdTasks: TaskDetails[] = [];

    // find first create task and put it to queue
    for (let i = 0; i < sortedMissionTasks.length; i++) {
      const task = sortedMissionTasks[i];

      if (isOpenMissionAction(task.action)) {
        openTask = task;
      }

      if (
        task.status === TaskStatus.Created ||
        task.status === TaskStatus.Failed
      ) {
        createdTasks.push(task);
      }

      if (
        task.status === TaskStatus.Await ||
        task.status === TaskStatus.Initiated
      ) {
        awaitingTasks.push(task);
      }
    }

    if (awaitingTasks.length > 0 || !openTask) {
      return false;
    }

    await this.updateMany(
      createdTasks.map((task) => ({
        id: task.id,
        status: TaskStatus.Stopped,
        logs: [
          ...task.logs,
          JSON.stringify({
            timestamp: Date.now(),
            message: `Stopped by mission close action`,
          }),
        ],
      })),
    );

    // no need to proceed
    if (openTask.status === 'Created') {
      return true;
    }

    const openEvent = missionEventParsers
      .find((parser) => parser.eventName === openTask.action.name)!
      .actionParser(openTask.action);

    const currentPrice = await this.tradingVariableService.getPair(
      openEvent.args.t.pairIndex,
    );

    const newAction = await this.actionsService.createCloseMissionAction(
      mission.targetPositionId,
      currentPrice.price.toString(),
    );

    await this.createMany([
      {
        missionId: mission.id,
        actionId: newAction.id,
        status: TaskStatus.Created,
        logs: [
          JSON.stringify({
            timestamp: Date.now(),
            message: `Task created`,
          }),
        ],
      },
    ]);

    return true;
  }

  async loadTasks() {
    const tasks = await this.prismaService.task.findMany({
      where: {
        status: {
          not: TaskStatus.Completed,
        },
      },
      include: {
        action: true,
        mission: true,
      },
    });

    tasks.forEach((task) => {
      const tasksByMissionMap = this.tasksByBotMap.get(task.mission.botId);

      if (tasksByMissionMap) {
        const arr = tasksByMissionMap.get(task.missionId);

        if (arr) {
          arr.push(task);
        } else {
          tasksByMissionMap.set(task.missionId, [task]);
        }
      } else {
        const tempMap = new Map<number, TaskShallowDetails[]>();
        tempMap.set(task.missionId, [task]);
        this.tasksByBotMap.set(task.mission.botId, tempMap);
      }
    });
  }

  async createMany(inputs: TaskCreateInput[]) {
    const newTasks = await this.prismaService.task.createManyAndReturn({
      data: inputs,
      include: {
        action: true,
        mission: true,
      },
    });

    newTasks.forEach((task) => {
      const tasksByMissionMap = this.tasksByBotMap.get(task.mission.botId);

      if (tasksByMissionMap) {
        const arr = tasksByMissionMap.get(task.missionId);

        if (arr) {
          arr.push(task);
        } else {
          tasksByMissionMap.set(task.missionId, [task]);
        }
      } else {
        const tempMap = new Map<number, TaskShallowDetails[]>();
        tempMap.set(task.missionId, [task]);
        this.tasksByBotMap.set(task.mission.botId, tempMap);
      }
    });

    this.pubSub.publish(SUBSCRIPTION_TOKEN.taskAdded, {
      [SUBSCRIPTION_TOKEN.taskAdded]: newTasks,
    });
  }

  async updateMany(inputs: TaskUpdateInput[]) {
    const updatedTasks = await this.prismaService.$transaction(
      inputs.map((input) => {
        return this.prismaService.task.update({
          where: {
            id: input.id,
          },
          data: input,
          include: {
            action: true,
            mission: true,
          },
        });
      }),
    );

    updatedTasks.forEach((task) => {
      const tasksByMissionMap = this.tasksByBotMap.get(task.mission.botId);

      if (tasksByMissionMap) {
        const arr = tasksByMissionMap.get(task.missionId);

        if (arr) {
          if (task.status === TaskStatus.Completed) {
            tasksByMissionMap.set(
              task.missionId,
              arr.filter((item) => item.id !== task.id),
            );
          } else {
            const index = arr.findIndex((item) => item.id === task.id);
            arr[index] = task;
          }
        }
      }
    });

    this.pubSub.publish(SUBSCRIPTION_TOKEN.taskUpdated, {
      [SUBSCRIPTION_TOKEN.taskUpdated]: updatedTasks,
    });
  }

  filterTasks(botId: number, missionId: number) {
    const tasksByMissionMap = this.tasksByBotMap.get(botId);

    if (!tasksByMissionMap) {
      return [];
    }

    return tasksByMissionMap.get(missionId) || [];
  }

  findMissionTasksForMOIEvent(botIds: number[]) {
    return botIds
      .map((botId) => {
        const tasksByMissionMap = this.tasksByBotMap.get(botId);

        if (!tasksByMissionMap) {
          return [];
        }

        const tasks = Array.from(tasksByMissionMap.values()).reduce(
          (acc, item) => [...acc, ...item],
          [],
        );

        return tasks
          .filter((task) => isOpenMissionAction(task.action))
          .filter(
            (task) =>
              task.status === TaskStatus.Await &&
              task.mission.achievePositionId === null,
          );
      })
      .reduce((acc, item) => [...acc, ...item], []);
  }

  findAll() {
    return this.prismaService.task.findMany();
  }

  findOne(id: number) {
    return this.prismaService.task.findUnique({ where: { id } });
  }

  findByMission(missionId: number) {
    return this.prismaService.task.findMany({ where: { missionId } });
  }

  async handleLeaderActions(actions: ActionContext<MissionContext>[]) {
    const filteredActions = actions.filter(
      (item) =>
        updateEventNames.includes(item.action.name) ||
        missionEventNames.includes(item.action.name),
    );

    await this.createMany(
      filteredActions.map((item) => ({
        missionId: item.context.mission.id,
        actionId: item.action.id,
        status: TaskStatus.Created,
        logs: [
          JSON.stringify({
            timestamp: Date.now(),
            message: `Task created`,
          }),
        ],
      })),
    );
  }

  getTask(
    botId: number,
    missionId: number,
    filter: (action: Action) => boolean,
  ): TaskShallowDetails | null {
    const tasks = this.filterTasks(botId, missionId).filter((task) =>
      filter(task.action),
    );

    if (tasks.length !== 1) {
      return null;
    }

    return tasks[0];
  }

  async handleFollowerActions(actions: ActionContext<MissionContext>[]) {
    const followerActionInputs: CreateFollowerActionInput[] = [];
    const taskUpateInputs: TaskUpdateInput[] = [];

    for (const { action, context } of actions) {
      let status: TaskStatus = TaskStatus.Completed;
      let filter: (action: Action) => boolean = () => false;

      if (missionCanceledEventNames.includes(action.name)) {
        filter =
          action.name === marketOpenCanceledEventParser.eventName
            ? isOpenMissionAction
            : isCloseMissionAction;

        status = TaskStatus.Failed;
      }

      if (action.name === marketOrderInitiatedEventParser.eventName) {
        const event = marketOrderInitiatedEventParser.actionParser(action);

        filter = event.args.open ? isOpenMissionAction : isCloseMissionAction;

        status = TaskStatus.Initiated;
      }

      if (missionEventNames.includes(action.name)) {
        filter = isOpenMissionAction(action)
          ? isOpenMissionAction
          : isCloseMissionAction;

        status = TaskStatus.Completed;
      }

      if (updateEventNames.includes(action.name)) {
        filter = (leaderAction: Action) => {
          return isSameUpdateAction(leaderAction, action);
        };

        status = TaskStatus.Completed;
      }

      const task = this.getTask(context.bot.id, context.mission.id, filter);

      if (!task) {
        this.logger.error(
          'Unexpected app error: There are two open mission tasks for one mission, or no open mission',
        );
        continue;
      }

      followerActionInputs.push({
        taskId: task.id,
        actionId: action.id,
      });

      taskUpateInputs.push({
        id: task.id,
        status,
        logs: [
          ...task.logs,
          JSON.stringify({
            timestamp: Date.now(),
            message: `Task updated with status - ${status}`,
          }),
        ],
      });
    }

    await this.updateMany(taskUpateInputs);
    await this.followerActionsService.createMany(followerActionInputs);
  }
}
