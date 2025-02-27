import { Inject, Injectable, Logger } from '@nestjs/common';
import { MissionStatus, TaskStatus } from '@prisma/client';
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

import { ActionContext, CancelReason, MissionContext } from 'src/types';
import { TaskDetails, TaskBackwardDetails } from './entities/task.entity';
import { TaskCreateInput, TaskUpdateInput } from './dto/task.input';

import { marketOrderInitiatedEventParser } from 'src/actions/eventParsers/market-order-initiated.parser';
import { marketOpenCanceledEventParser } from 'src/actions/eventParsers/market-open-canceled';
import { Action } from 'src/actions/entities/action.entity';

import { CreateFollowerActionInput } from 'src/follower-actions/dto/follower-action.input';
import { FollowerActionsService } from 'src/follower-actions/follower-actions.service';

import { CloseMissionAction, SUBSCRIPTION_TOKEN } from 'src/utils/constants';
import { TradingVariableService } from 'src/global/trading-variable.service';

import { ActionsService } from 'src/actions/actions.service';
import { Mission } from 'src/missions/entities/mission.entity';
import { PUB_SUB } from 'src/global/global.module';
import { leverageUpdateExecutedEventParser } from 'src/actions/eventParsers/leverage-update-executed.parser';
import { positionSizeIncreaseExecutedEventParser } from 'src/actions/eventParsers/position-size-increase-executed.parser';
import { positionSizeDecreaseExecutedEventParser } from 'src/actions/eventParsers/position-size-decrease-executed.parser';
import { marketCloseCanceledEventParser } from 'src/actions/eventParsers/market-close-canceled';

@Injectable()
export class TasksService {
  constructor(
    @Inject(PUB_SUB) private readonly pubSub: PubSub,
    private prismaService: PrismaService,
    private tradingVariableService: TradingVariableService,
    private followerActionsService: FollowerActionsService,
    private actionsService: ActionsService,
    private readonly logger: Logger,
  ) {}

  async getTasks(ids: number[]): Promise<TaskBackwardDetails[]> {
    return await this.prismaService.task.findMany({
      where: {
        id: { in: ids },
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
  }

  async closeMissionTasks(
    mission: Mission,
    isForce: boolean,
  ): Promise<'closed' | 'closing' | 'awaiting'> {
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
      return 'closed';
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

    if (!isForce && awaitingTasks.length > 0) {
      return 'awaiting';
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

    if (!openTask || openTask.status !== TaskStatus.Completed) {
      return 'closed';
    }

    const openEvent = missionEventParsers
      .find((parser) => parser.eventName === openTask.action.name)!
      .actionParser(openTask.action);

    const currentPrice = await this.tradingVariableService.getPairPrice(
      openEvent.args.t.pairIndex,
    );

    const newAction = await this.actionsService.createCloseMissionAction(
      mission.targetPositionId,
      currentPrice.toString(),
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

    return 'closing';
  }

  private async createMany(inputs: TaskCreateInput[]) {
    const newTasks = await this.prismaService.task.createManyAndReturn({
      data: inputs,
      include: {
        action: true,
        mission: true,
      },
    });

    const tasks = await this.getTasks(newTasks.map((task) => task.id));

    this.pubSub.publish(SUBSCRIPTION_TOKEN.taskAdded, {
      [SUBSCRIPTION_TOKEN.taskAdded]: tasks,
    });

    return newTasks;
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

    const tasks = await this.getTasks(updatedTasks.map((task) => task.id));

    this.pubSub.publish(SUBSCRIPTION_TOKEN.taskUpdated, {
      [SUBSCRIPTION_TOKEN.taskUpdated]: tasks,
    });
  }

  async stopTask(id: number): Promise<TaskBackwardDetails | null> {
    const task = await this.prismaService.task.findUnique({
      where: {
        id,
      },
    });

    if (!task) {
      throw new Error('Task not found');
    }

    await this.updateMany([
      {
        id: task.id,
        status: TaskStatus.Stopped,
        logs: [
          ...task.logs,
          JSON.stringify({
            timestamp: Date.now(),
            message: `Stopped by mission close action`,
          }),
        ],
      },
    ]);

    const tasks = await this.getTasks([id]);

    return tasks[0] || null;
  }

  private async getTasksByMissionMap(missionIds: number[]) {
    const missionTasks = await this.prismaService.task.findMany({
      where: {
        missionId: {
          in: missionIds,
        },
      },
      include: {
        action: true,
        mission: true,
      },
    });

    const tasksByMissionMap = new Map<number, TaskDetails[]>();

    missionTasks.forEach((task) => {
      const arr = tasksByMissionMap.get(task.missionId);

      if (arr) {
        arr.push(task);
      } else {
        tasksByMissionMap.set(task.missionId, [task]);
      }
    });

    return tasksByMissionMap;
  }

  async findMissionTasksForMOIEvent(botIds: number[]) {
    return await this.prismaService.task.findMany({
      where: {
        mission: {
          botId: {
            in: botIds,
          },
          status: MissionStatus.Created,
          achievePositionId: null,
        },
        status: TaskStatus.Await,
      },
      include: {
        action: true,
        mission: true,
      },
    });
  }

  async handleLeaderActions(
    actions: ActionContext<MissionContext>[],
    missionCloseCallback: (missionIds: number[]) => Promise<void>,
  ) {
    const filteredActions = actions.filter((item) => {
      if (
        ![...updateEventNames, ...missionEventNames].includes(item.action.name)
      ) {
        return false;
      }

      if (item.action.name === leverageUpdateExecutedEventParser.eventName) {
        const { args } = leverageUpdateExecutedEventParser.actionParser(
          item.action,
        );

        if (args.cancelReason !== CancelReason.NONE) {
          return false;
        }
      }

      if (
        item.action.name === positionSizeIncreaseExecutedEventParser.eventName
      ) {
        const { args } = positionSizeIncreaseExecutedEventParser.actionParser(
          item.action,
        );

        if (args.cancelReason !== CancelReason.NONE) {
          return false;
        }
      }

      if (
        item.action.name === positionSizeDecreaseExecutedEventParser.eventName
      ) {
        const { args } = positionSizeDecreaseExecutedEventParser.actionParser(
          item.action,
        );

        if (args.cancelReason !== CancelReason.NONE) {
          return false;
        }
      }

      return true;
    });

    const closeActions = filteredActions.filter((item) =>
      isCloseMissionAction(item.action),
    );
    const noneCloseActions = filteredActions.filter(
      (item) => !isCloseMissionAction(item.action),
    );

    const createdOrFailedTasks: TaskDetails[] = [];
    const closeActionsStopped: ActionContext<MissionContext>[] = [];
    const normalClosedActions: ActionContext<MissionContext>[] = [];

    const tasksByMissionMap = await this.getTasksByMissionMap(
      closeActions.map((item) => item.context.mission.id),
    );

    closeActions.forEach((action) => {
      const sortedTasks = (
        tasksByMissionMap.get(action.context.mission.id) || []
      ).sort((a, b) => {
        if (a.action.blockNumber !== b.action.blockNumber) {
          return a.action.blockNumber - b.action.blockNumber;
        }

        return a.action.orderInBlock - b.action.orderInBlock;
      });

      sortedTasks.forEach((task) => {
        if (
          task.status === TaskStatus.Created ||
          task.status === TaskStatus.Failed
        ) {
          createdOrFailedTasks.push(task);
        }
      });

      const openTask = sortedTasks.find((task) =>
        isOpenMissionAction(task.action),
      );

      if (
        openTask &&
        (TaskStatus.Completed === openTask.status ||
          TaskStatus.Await == openTask.status ||
          TaskStatus.Initiated === openTask.status)
      ) {
        normalClosedActions.push(action);
      } else {
        closeActionsStopped.push(action);
      }
    });

    await this.updateMany(
      createdOrFailedTasks.map((task) => ({
        id: task.id,
        status: TaskStatus.Stopped,
        logs: [
          ...task.logs,
          JSON.stringify({
            timestamp: Date.now(),
            message: `Stopped by close action`,
          }),
        ],
      })),
    );

    await this.createMany(
      [...noneCloseActions, ...normalClosedActions].map((item) => ({
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

    await this.createMany(
      closeActionsStopped.map((item) => ({
        missionId: item.context.mission.id,
        actionId: item.action.id,
        status: TaskStatus.Stopped,
        logs: [
          JSON.stringify({
            timestamp: Date.now(),
            message: `Stopped by not executed mission`,
          }),
        ],
      })),
    );

    await missionCloseCallback(
      closeActionsStopped.map((item) => item.context.mission.id),
    );
  }

  async handleFollowerActions(
    actions: ActionContext<MissionContext>[],
    missionCloseCallback: (missionIds: number[]) => Promise<void>,
  ) {
    const followerActionInputs: CreateFollowerActionInput[] = [];
    const taskUpateInputs: TaskUpdateInput[] = [];

    const closeActions: ActionContext<MissionContext>[] = [];
    const manualCloseActions: {
      missionId: number;
      pairIndex: number;
      targetPositionId: number;
    }[] = [];

    const tasksByMissionMap = await this.getTasksByMissionMap(
      actions.map((item) => item.context.mission.id),
    );

    for (const { action, context } of actions) {
      let status: TaskStatus = TaskStatus.Completed;
      let filter: (action: Action) => boolean = () => false;

      if (missionCanceledEventNames.includes(action.name)) {
        filter =
          action.name === marketOpenCanceledEventParser.eventName
            ? isOpenMissionAction
            : (action: Action) =>
                action.name === CloseMissionAction ||
                isCloseMissionAction(action);

        if (action.name === marketCloseCanceledEventParser.eventName) {
          const event = marketCloseCanceledEventParser.actionParser(action);

          manualCloseActions.push({
            missionId: context.mission.id,
            pairIndex: Number(event.args.pairIndex),
            targetPositionId: context.mission.targetPositionId,
          });
        }

        status = TaskStatus.Failed;
      }

      if (action.name === marketOrderInitiatedEventParser.eventName) {
        const event = marketOrderInitiatedEventParser.actionParser(action);

        filter = event.args.open
          ? isOpenMissionAction
          : (action: Action) =>
              action.name === CloseMissionAction ||
              isCloseMissionAction(action);

        status = TaskStatus.Initiated;
      }

      if (missionEventNames.includes(action.name)) {
        filter = isOpenMissionAction(action)
          ? isOpenMissionAction
          : (action: Action) =>
              action.name === CloseMissionAction ||
              isCloseMissionAction(action);

        status = TaskStatus.Completed;
      }

      if (updateEventNames.includes(action.name)) {
        filter = (leaderAction: Action) => {
          return isSameUpdateAction(leaderAction, action);
        };

        status = TaskStatus.Completed;
      }

      const missionTasks = (tasksByMissionMap.get(context.mission.id) || [])
        .filter((item) => item.missionId === context.mission.id)
        .filter(
          (task) =>
            task.status !== TaskStatus.Completed &&
            task.status !== TaskStatus.Stopped,
        )
        .filter((task) => filter(task.action));

      const task = missionTasks.length === 1 ? missionTasks[0] : null;

      if (!task) {
        if (
          missionEventNames.includes(action.name) &&
          isCloseMissionAction(action)
        ) {
          closeActions.push({ action, context });

          const newAction = await this.actionsService.createCloseMissionAction(
            context.mission.targetPositionId,
            '0',
          );

          const newTasks = await this.createMany([
            {
              missionId: context.mission.id,
              actionId: newAction.id,
              status: TaskStatus.Completed,
              logs: [
                JSON.stringify({
                  timestamp: Date.now(),
                  message: `Task created for follower close action that without having a close task`,
                }),
              ],
            },
          ]);

          if (newTasks.length !== 1) {
            this.logger.error(
              'Unexpected app error: There are one more open mission tasks for one mission, or no open mission',
            );

            continue;
          }

          followerActionInputs.push({
            taskId: newTasks[0].id,
            actionId: action.id,
          });
        } else {
          this.logger.error(
            'Unexpected app error: There are two open mission tasks for one mission, or no open mission',
          );
        }

        continue;
      }

      if (isCloseMissionAction(action)) {
        closeActions.push({ action, context });
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

    const promises = manualCloseActions.map(async (item) => {
      const currentPrice = await this.tradingVariableService.getPairPrice(
        item.pairIndex,
      );

      const newAction = await this.actionsService.createCloseMissionAction(
        item.targetPositionId,
        currentPrice.toString(),
      );

      await this.createMany([
        {
          missionId: item.missionId,
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
    });

    if (promises.length > 0) {
      await Promise.all(promises);
    }

    await this.updateMany(taskUpateInputs);
    await this.followerActionsService.createMany(followerActionInputs);

    await missionCloseCallback(
      closeActions.map((item) => item.context.mission.id),
    );
  }

  async getAlertTasks(): Promise<TaskBackwardDetails[]> {
    return await this.prismaService.task.findMany({
      where: {
        status: {
          notIn: [TaskStatus.Stopped, TaskStatus.Completed],
        },
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
  }
}
