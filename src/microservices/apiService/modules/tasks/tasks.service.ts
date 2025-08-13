import { Inject, Injectable } from '@nestjs/common';
import { MissionStatus, TaskStatus } from '@prisma/client';
import { ClientProxy } from '@nestjs/microservices';

import {
  missionEventNames,
  updateEventNames,
  isOpenMissionAction,
  isCloseMissionAction,
  isSameUpdateAction,
  missionEventParsers,
} from 'src/microservices/web3Service/platform/gns/v10/eventParsers';
import { ActionContext, MissionContext } from 'src/types';
import { CancelReason } from 'src/microservices/web3Service/platform/gns/v10/types';

import { TaskDetails, TaskBackwardDetails } from './entities/task.entity';
import { TaskCreateInput, TaskUpdateInput } from './dto/task.input';

import { Action } from 'src/microservices/apiService/modules/actions/entities/action.entity';

import { CreateFollowerActionInput } from 'src/microservices/apiService/modules/follower-actions/dto/follower-action.input';

import {
  CloseMissionAction,
  PATTERNS,
  SERVICE_NAMES,
} from 'src/utils/constants';

import {
  ManualParams,
  Mission,
  MissionDetails,
} from 'src/microservices/apiService/modules/missions/entities/mission.entity';

import { leverageUpdateExecutedEventParser } from 'src/microservices/web3Service/platform/gns/v10/eventParsers/leverage-update-executed.parser';
import { positionSizeIncreaseExecutedEventParser } from 'src/microservices/web3Service/platform/gns/v10/eventParsers/position-size-increase-executed.parser';
import { positionSizeDecreaseExecutedEventParser } from 'src/microservices/web3Service/platform/gns/v10/eventParsers/position-size-decrease-executed.parser';
import { marketCloseCanceledEventParser } from 'src/microservices/web3Service/platform/gns/v10/eventParsers/market-close-canceled';
import { marketOrderInitiatedEventParser } from 'src/microservices/web3Service/platform/gns/v10/eventParsers/market-order-initiated.parser';
import { marketOpenCanceledEventParser } from 'src/microservices/web3Service/platform/gns/v10/eventParsers/market-open-canceled';

import { FollowerActionsService } from 'src/microservices/apiService/modules/follower-actions/follower-actions.service';
import { ActionsService } from 'src/microservices/apiService/modules/actions/actions.service';
import { PrismaService } from 'src/global/prisma.service';
import { LogsService } from 'src/global/logs.service';
import { GnsService } from 'src/global/gns.service';

@Injectable()
export class TasksService {
  constructor(
    @Inject(SERVICE_NAMES.REDIS_SERVICE) private redisClient: ClientProxy,
    private prismaService: PrismaService,
    private gnsService: GnsService,
    private followerActionsService: FollowerActionsService,
    private actionsService: ActionsService,
    private readonly logger: LogsService,
  ) {}

  private async getTasks(ids: number[]): Promise<TaskBackwardDetails[]> {
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

    const currentPrice = await this.gnsService.getPairPrice(
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

  async findOpenTask(mission: Mission): Promise<TaskDetails | null> {
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
      return null;
    }

    const sortedMissionTasks = allMissionTasks.sort((a, b) => {
      if (a.action.blockNumber !== b.action.blockNumber) {
        return a.action.blockNumber - b.action.blockNumber;
      }

      return a.action.orderInBlock - b.action.orderInBlock;
    });

    let openTask: TaskDetails | null = null;

    // find first create task and put it to queue
    for (let i = 0; i < sortedMissionTasks.length; i++) {
      const task = sortedMissionTasks[i];

      if (isOpenMissionAction(task.action)) {
        openTask = task;
      }
    }

    return openTask;
  }

  async cloneOpenTask(
    task: TaskDetails,
    clonedMissionId: number,
    manualParams?: ManualParams,
  ) {
    const openEvent = missionEventParsers
      .find((parser) => parser.eventName === task.action.name)!
      .actionParser(task.action);

    const currentPrice = await this.gnsService.getPairPrice(
      openEvent.args.t.pairIndex,
    );

    const newArgs = JSON.stringify({
      ...openEvent.args,
      t: {
        ...openEvent.args.t,
        openPrice: currentPrice.toString(),
        ...(manualParams
          ? {
              collateralAmount: manualParams.collateralAmount,
              leverage: manualParams.leverage,
              long: manualParams.long,
            }
          : {
              collateralAmount: openEvent.args.t.collateralAmount,
              leverage: openEvent.args.t.leverage,
              long: openEvent.args.t.long,
            }),
      },
      isManualOpen: manualParams ? true : false,
    });

    const clonedAction = await this.prismaService.action.create({
      data: {
        name: task.action.name,
        positionId: task.action.positionId,
        args: newArgs,
        blockNumber: task.action.blockNumber,
        orderInBlock: task.action.orderInBlock,
      },
    });

    await this.createMany([
      {
        missionId: clonedMissionId,
        actionId: clonedAction.id,
        status: TaskStatus.Created,
        logs: [
          JSON.stringify({
            timestamp: Date.now(),
            message: `Task created`,
          }),
        ],
      },
    ]);
  }

  private async createMany(inputs: TaskCreateInput[]) {
    if (inputs.length === 0) {
      return [];
    }

    const newTasks = await this.prismaService.task.createManyAndReturn({
      data: inputs,
      include: {
        action: true,
        mission: true,
      },
    });

    const tasks = await this.getTasks(newTasks.map((task) => task.id));

    this.redisClient.emit(PATTERNS.Tasks.TaskCreated, tasks);

    return newTasks;
  }

  async updateMany(inputs: TaskUpdateInput[]) {
    if (inputs.length === 0) {
      return;
    }

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

    this.redisClient.emit(PATTERNS.Tasks.TaskUpdated, tasks);
  }

  async stopTask(userId: string, id: number): Promise<boolean> {
    const task = await this.prismaService.task.findUnique({
      where: {
        id,
        mission: {
          bot: {
            plan: {
              userId,
            },
          },
        },
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

    return true;
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
    callbacks: {
      closeCancelded: (missionIds: number[]) => Promise<void>;
      openCanceled: (missionIds: number[]) => Promise<void>;
      clone: (missions: MissionDetails[]) => Promise<void>;
    },
  ) {
    const followerActionInputs: CreateFollowerActionInput[] = [];
    const taskUpateInputs: TaskUpdateInput[] = [];

    const closeActions: ActionContext<MissionContext>[] = [];
    const manualCloseActions: {
      missionId: number;
      pairIndex: number;
      targetPositionId: number;
    }[] = [];

    const cloneMissions: MissionDetails[] = [];
    const openCanceledMissionIds: number[] = [];

    const tasksByMissionMap = await this.getTasksByMissionMap(
      actions.map((item) => item.context.mission.id),
    );

    for (const { action, context } of actions) {
      let status: TaskStatus = TaskStatus.Completed;
      let filter: (action: Action) => boolean = () => false;

      if (action.name === marketOpenCanceledEventParser.eventName) {
        filter = isOpenMissionAction;
        status = TaskStatus.Failed;

        const event = marketOpenCanceledEventParser.actionParser(action);

        if (event.args.cancelReason === CancelReason.SLIPPAGE) {
          cloneMissions.push(context.mission);
        }

        openCanceledMissionIds.push(context.mission.id);
      }

      if (action.name === marketCloseCanceledEventParser.eventName) {
        filter = (action: Action) =>
          action.name === CloseMissionAction || isCloseMissionAction(action);
        status = TaskStatus.Failed;

        const event = marketCloseCanceledEventParser.actionParser(action);

        manualCloseActions.push({
          missionId: context.mission.id,
          pairIndex: Number(event.args.pairIndex),
          targetPositionId: context.mission.targetPositionId,
        });
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
            task.status === TaskStatus.Await ||
            task.status === TaskStatus.Initiated,
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
            await this.logger.log({
              severity: 'Warning',
              summary: 'TasksService>handleFollowerActions',
              details:
                'Unexpected app error: There are one more open mission tasks for one mission, or no open mission',
            });

            continue;
          }

          followerActionInputs.push({
            taskId: newTasks[0].id,
            actionId: action.id,
          });
        } else {
          await this.logger.log({
            severity: 'Warning',
            summary: 'TasksService>handleFollowerActions',
            details:
              'Unexpected app error: There are two open mission tasks for one mission, or no open mission',
          });
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

    for (const item of manualCloseActions) {
      const currentPrice = await this.gnsService.getPairPrice(item.pairIndex);

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
    }

    await this.updateMany(taskUpateInputs);
    await this.followerActionsService.createMany(followerActionInputs);

    if (closeActions.length > 0) {
      await callbacks.closeCancelded(
        closeActions.map((item) => item.context.mission.id),
      );
    }

    if (openCanceledMissionIds.length > 0) {
      await callbacks.openCanceled(openCanceledMissionIds);
    }

    if (cloneMissions.length > 0) {
      await callbacks.clone(cloneMissions);
    }
  }

  async getAlertTasks(userId: string): Promise<TaskBackwardDetails[]> {
    return await this.prismaService.task.findMany({
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
