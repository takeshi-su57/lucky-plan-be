import { Injectable, Logger } from '@nestjs/common';
import { TaskStatus } from '@prisma/client';
import { Address } from 'viem';

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

import { ActionContext, MissionContext, TradeType } from 'src/types';
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

import { USDCCollateralIndex } from 'src/utils/constants';
import { PriceService } from 'src/global/price.service';
import { getReadableError } from 'src/utils';

@Injectable()
export class TasksService {
  // Map<botId, Map<missionId, TaskDetails[]>>
  private tasksByBotMap = new Map<number, Map<number, TaskShallowDetails[]>>();
  status: 'process' | 'ready';

  constructor(
    private prismaService: PrismaService,
    private chainsService: ChainsService,
    private tradeService: TradeService,
    private pricesService: PriceService,
    private followerActionsService: FollowerActionsService,
    private readonly logger: Logger,
  ) {
    this.status = 'ready';
    this.loadTasks();
  }

  async performTask(
    task: TaskDetails,
  ): Promise<{ success: boolean; message: string }> {
    try {
      const { action, mission } = task;
      const { bot, achievePosition } = mission;
      const { follower, contract } = bot;

      if (!isOpenMissionAction(action) && !achievePosition) {
        throw new Error(
          'Wrong Execuation of task, Task does not have its achievePosition',
        );
      }

      const walletClient = this.chainsService.walletClient(
        contract.chainId,
        follower,
      );
      const publicClient = this.chainsService.publicClient(contract.chainId);

      let tx: `0x${string}` | null = null;

      switch (action.name) {
        case tradeMaxClosingSlippagePUpdatedEventParser.eventName: {
          const { args } =
            tradeMaxClosingSlippagePUpdatedEventParser.actionParser(action);

          tx = await this.tradeService.updateMaxClosingSlippageP(
            walletClient,
            publicClient,
            contract.chainId,
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
            contract.chainId,
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

          tx = await this.tradeService.increasePositionSize(
            walletClient,
            publicClient,
            contract.chainId,
            {
              index: achievePosition!.index,
              collateralDelta: BigInt(args.collateralDelta),
              leverageDelta: Number(args.leverageDelta),
              expectedPrice: BigInt(args.values.newOpenPrice),
              maxSlippageP: 1000,
            },
          );

          break;
        }
        case positionSizeDecreaseExecutedEventParser.eventName: {
          const { args } =
            positionSizeDecreaseExecutedEventParser.actionParser(action);

          tx = await this.tradeService.decreasePositionSize(
            walletClient,
            publicClient,
            contract.chainId,
            {
              index: achievePosition!.index,
              collateralDelta: BigInt(args.collateralDelta),
              leverageDelta: Number(args.leverageDelta),
              expectedPrice: BigInt(args.oraclePrice),
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
            const usdcPrice = await this.pricesService.getUSDCPrice();

            if (isOpenMissionAction(action)) {
              tx = await this.tradeService.openTrade(
                walletClient,
                publicClient,
                contract.chainId,
                {
                  trade: {
                    user: follower.address as Address,
                    index: 0,
                    pairIndex: t.pairIndex,
                    leverage: t.leverage,
                    long: t.long,
                    isOpen: true,
                    collateralIndex: USDCCollateralIndex,
                    tradeType: TradeType.TRADE,
                    collateralAmount:
                      (BigInt(t.collateralAmount) *
                        BigInt(collateralPriceUsd)) /
                      usdcPrice,
                    openPrice: BigInt(t.openPrice),
                    tp: BigInt(t.tp),
                    sl: BigInt(t.sl),
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
                contract.chainId,
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
                contract: true,
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
  }

  async performAvailableTasks() {
    this.status = 'process';

    const allTasks = await this.prismaService.task.findMany({
      where: {
        status: {
          not: TaskStatus.Completed,
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
                contract: true,
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

    try {
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
          botTasks.push(
            openMissionTasks.created.sort(
              (a, b) =>
                new Date(a.createdAt).getTime() -
                new Date(b.createdAt).getTime(),
            )[0],
          );
        }
      }

      console.log('botTasks', botTasks);

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

  updateStatus(id: number, status: TaskStatus) {
    return this.prismaService.task.update({
      where: { id },
      data: {
        status,
      },
    });
  }

  async handleLeaderActions(actions: ActionContext<MissionContext>[]) {
    const filteredActions = actions.filter(
      (item) =>
        updateEventNames.includes(item.action.name) ||
        missionEventNames.includes(item.action.name),
    );

    console.log('handle Leader actions in task service ===>', filteredActions);

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
    console.log(
      'handle follower actions ===>',
      actions,
      actions.map((action) => action.context.mission),
    );

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
