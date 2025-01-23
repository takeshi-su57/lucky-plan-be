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
import {
  TaskWithActions,
  TaskDetails,
  TaskShallowDetails,
} from './entities/task.entity';
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

@Injectable()
export class TasksService {
  // Map<botId, Map<missionId, TaskDetails[]>>
  private tasksByBotMap = new Map<number, Map<number, TaskShallowDetails[]>>();
  status: 'process' | 'ready' = 'process';

  constructor(
    @Inject(PUB_SUB) private readonly pubSub: PubSub,
    private prismaService: PrismaService,
    private tradingVariableService: TradingVariableService,
    private followerActionsService: FollowerActionsService,
    private actionsService: ActionsService,
    private readonly logger: Logger,
  ) {
    this.loadTasks();
  }

  async closeMissionTasks(
    mission: Mission,
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
      this.handleTasksByCloseMission([
        { missionId: mission.id, botId: mission.botId },
      ]);
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

    if (!openTask) {
      this.handleTasksByCloseMission([
        { missionId: mission.id, botId: mission.botId },
      ]);
      return 'closed';
    }

    if (awaitingTasks.length > 0) {
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

    // no need to proceed
    if (openTask.status !== TaskStatus.Completed) {
      this.handleTasksByCloseMission([
        { missionId: mission.id, botId: mission.botId },
      ]);
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

  async loadTasks() {
    this.status = 'process';

    const tasks = await this.prismaService.task.findMany({
      where: {
        mission: {
          status: {
            not: MissionStatus.Closed,
          },
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

    this.status = 'ready';
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

    this.pubSub.publish(SUBSCRIPTION_TOKEN.taskUpdated, {
      [SUBSCRIPTION_TOKEN.taskUpdated]: updatedTasks,
    });
  }

  handleTasksByCloseMission(inputs: { missionId: number; botId: number }[]) {
    inputs.forEach((input) => {
      const tasksByMissionMap = this.tasksByBotMap.get(input.botId);

      if (tasksByMissionMap) {
        tasksByMissionMap.set(input.missionId, []);
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
    return this.prismaService.task.findMany({
      include: {
        action: true,
        mission: true,
      },
    });
  }

  findByStatus(status: TaskStatus) {
    return this.prismaService.task.findMany({
      where: {
        status,
      },
      include: {
        action: true,
        mission: true,
      },
    });
  }

  findOne(id: number): Promise<TaskWithActions | null> {
    return this.prismaService.task.findUnique({
      where: { id },
      include: { action: true, followerActions: { include: { action: true } } },
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
    const noneCloseActions = filteredActions.filter((item) =>
      isCloseMissionAction(item.action),
    );

    const createdOrFailedTasks: TaskShallowDetails[] = [];
    const closeActionsStopped: ActionContext<MissionContext>[] = [];
    const normalClosedActions: ActionContext<MissionContext>[] = [];

    closeActions.forEach((action) => {
      const sortedTasks = this.filterTasks(
        action.context.bot.id,
        action.context.mission.id,
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

    this.handleTasksByCloseMission(
      closeActionsStopped.map((item) => ({
        missionId: item.context.mission.id,
        botId: item.context.bot.id,
      })),
    );

    await missionCloseCallback(
      closeActionsStopped.map((item) => item.context.mission.id),
    );
  }

  getTask(
    botId: number,
    missionId: number,
    filter: (action: Action) => boolean,
  ): TaskShallowDetails | null {
    const tasks = this.filterTasks(botId, missionId)
      .filter(
        (task) =>
          task.status !== TaskStatus.Completed &&
          task.status !== TaskStatus.Stopped,
      )
      .filter((task) => filter(task.action));

    if (tasks.length !== 1) {
      return null;
    }

    return tasks[0];
  }

  async handleFollowerActions(
    actions: ActionContext<MissionContext>[],
    missionCloseCallback: (missionIds: number[]) => Promise<void>,
  ) {
    const followerActionInputs: CreateFollowerActionInput[] = [];
    const taskUpateInputs: TaskUpdateInput[] = [];

    const closeActions: ActionContext<MissionContext>[] = [];

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

      const task = this.getTask(context.bot.id, context.mission.id, filter);

      if (!task) {
        this.logger.error(
          'Unexpected app error: There are two open mission tasks for one mission, or no open mission',
        );
        continue;
      }

      if (isCloseMissionAction(task.action)) {
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

    await this.updateMany(taskUpateInputs);
    await this.followerActionsService.createMany(followerActionInputs);

    this.handleTasksByCloseMission(
      closeActions.map((item) => ({
        missionId: item.context.mission.id,
        botId: item.context.bot.id,
      })),
    );

    await missionCloseCallback(
      closeActions.map((item) => item.context.mission.id),
    );
  }
}
