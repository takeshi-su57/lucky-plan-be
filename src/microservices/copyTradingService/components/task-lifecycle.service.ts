import { Injectable } from '@nestjs/common';
import { MissionMode, Platform, TaskStatus } from 'generated/prisma/client';

import {
  missionEventNames,
  updateEventNames,
  isOpenMissionAction,
  isCloseMissionAction,
  isSameUpdateAction,
} from 'src/web3/platform/gns/v10/eventParsers';
import { ActionContext, MissionContext } from 'src/types';
import { CancelReason } from 'src/web3/platform/gns/v10/types';
import { Action } from 'src/microservices/apiService/modules/actions/entities/action.entity';
import { CreateFollowerActionInput } from 'src/microservices/apiService/modules/follower-actions/dto/follower-action.input';
import { CloseMissionAction, OpenMissionAction } from 'src/utils/constants';
import { Mission } from 'src/microservices/apiService/modules/missions/entities/mission.entity';
import { TaskDetails } from 'src/microservices/apiService/modules/tasks/entities/task.entity';
import { TaskUpdateInput } from 'src/microservices/apiService/modules/tasks/dto/task.input';
import { TasksService } from 'src/microservices/apiService/modules/tasks/tasks.service';
import { FollowerActionsService } from 'src/microservices/apiService/modules/follower-actions/follower-actions.service';
import { ActionsService } from 'src/microservices/apiService/modules/actions/actions.service';
import { LogsService } from 'src/global/logs.service';
import { GnsService } from 'src/web3/platform/gns/gns.service';
import { getWeb3Info } from 'src/web3/utils';
import { leverageUpdateExecutedEventParser } from 'src/web3/platform/gns/v10/eventParsers/leverage-update-executed.parser';
import { positionSizeIncreaseExecutedEventParser } from 'src/web3/platform/gns/v10/eventParsers/position-size-increase-executed.parser';
import { positionSizeDecreaseExecutedEventParser } from 'src/web3/platform/gns/v10/eventParsers/position-size-decrease-executed.parser';
import { marketCloseCanceledEventParser } from 'src/web3/platform/gns/v10/eventParsers/market-close-canceled';
import { marketOrderInitiatedEventParser } from 'src/web3/platform/gns/v10/eventParsers/market-order-initiated.parser';
import { marketOpenCanceledEventParser } from 'src/web3/platform/gns/v10/eventParsers/market-open-canceled';
import { positionIncreaseEventParser } from 'src/web3/platform/gmx/v2/eventParsers/position-increase.parser';
import { positionDecreaseEventParser } from 'src/web3/platform/gmx/v2/eventParsers/position-decrease.parser';

import {
  FollowerTaskCallbacks,
  TaskLifecycle,
} from '../copy-trading.components';

@Injectable()
export class TaskLifecycleService extends TaskLifecycle {
  constructor(
    private readonly tasksService: TasksService,
    private readonly gnsService: GnsService,
    private readonly followerActionsService: FollowerActionsService,
    private readonly actionsService: ActionsService,
    private readonly logger: LogsService,
  ) {
    super();
  }
  async handleLeaderMissionActions(
    actions: ActionContext<MissionContext>[],
    missionCloseCallback: (missionIds: number[]) => Promise<void>,
  ): Promise<void> {
    const filteredActions = actions.filter((item) => {
      if (item.context.bot.leaderContract.platform !== Platform.GNS) {
        return true;
      }

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
      getWeb3Info(
        item.context.bot.leaderContract.platform,
        item.context.bot.leaderContract.version,
      ).isCloseMissionAction(item.action),
    );
    const noneCloseActions = filteredActions.filter(
      (item) =>
        !getWeb3Info(
          item.context.bot.leaderContract.platform,
          item.context.bot.leaderContract.version,
        ).isCloseMissionAction(item.action),
    );

    const createdOrFailedTasks: TaskDetails[] = [];
    const closeActionsStopped: ActionContext<MissionContext>[] = [];
    const normalClosedActions: ActionContext<MissionContext>[] = [];

    const tasksByMissionMap = await this.tasksService.getTasksByMissionMap(
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

      const openTask = sortedTasks.find(
        (task) =>
          task.action.name === OpenMissionAction ||
          getWeb3Info(
            action.context.bot.leaderContract.platform,
            action.context.bot.leaderContract.version,
          ).isOpenMissionAction(task.action),
      );

      if (
        openTask &&
        (TaskStatus.Completed === openTask.status ||
          TaskStatus.Await === openTask.status ||
          TaskStatus.Initiated === openTask.status)
      ) {
        normalClosedActions.push(action);
      } else {
        closeActionsStopped.push(action);
      }
    });

    await this.tasksService.updateMany(
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

    await this.tasksService.createMany(
      [...noneCloseActions, ...normalClosedActions].map((item) => {
        return {
          missionId: item.context.mission.id,
          actionId: item.action.id,
          status:
            item.context.mission.mode === MissionMode.Signal
              ? TaskStatus.Stopped
              : TaskStatus.Created,
          logs: [
            JSON.stringify({
              timestamp: Date.now(),
              message: `Task ${item.context.mission.mode === MissionMode.Signal ? 'stopped' : 'created'}`,
            }),
          ],
        };
      }),
    );

    await this.tasksService.createMany(
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

  async handleFollowerMissionActions(
    actions: ActionContext<MissionContext>[],
    callbacks: FollowerTaskCallbacks,
  ): Promise<void> {
    const followerActionInputs: CreateFollowerActionInput[] = [];
    const taskUpateInputs: TaskUpdateInput[] = [];

    const closeActions: ActionContext<MissionContext>[] = [];
    const manualCloseActions: {
      missionId: number;
      pairIndex: number;
      address: string;
      targetPositionKey: string;
    }[] = [];

    const cloneMissions: Mission[] = [];
    const openCanceledMissionIds: number[] = [];

    const tasksByMissionMap = await this.tasksService.getTasksByMissionMap(
      actions.map((item) => item.context.mission.id),
    );

    for (const { action, context } of actions) {
      let status: TaskStatus = TaskStatus.Completed;
      let filter: (action: Action) => boolean = () => false;

      if (action.name === marketOpenCanceledEventParser.eventName) {
        filter = (_action: Action) =>
          _action.name === OpenMissionAction ||
          getWeb3Info(
            context.bot.leaderContract.platform,
            context.bot.leaderContract.version,
          ).isOpenMissionAction(_action);
        status = TaskStatus.Failed;

        const event = marketOpenCanceledEventParser.actionParser(action);

        if (event.args.cancelReason === CancelReason.SLIPPAGE) {
          cloneMissions.push(context.mission);
        }

        openCanceledMissionIds.push(context.mission.id);
      }

      if (action.name === marketCloseCanceledEventParser.eventName) {
        filter = (_action: Action) =>
          _action.name === CloseMissionAction ||
          getWeb3Info(
            context.bot.leaderContract.platform,
            context.bot.leaderContract.version,
          ).isCloseMissionAction(_action);
        status = TaskStatus.Failed;

        const event = marketCloseCanceledEventParser.actionParser(action);

        manualCloseActions.push({
          missionId: context.mission.id,
          pairIndex: Number(event.args.pairIndex),
          address: action.address,
          targetPositionKey: context.mission.targetPositionKey,
        });
      }

      if (action.name === marketOrderInitiatedEventParser.eventName) {
        const event = marketOrderInitiatedEventParser.actionParser(action);

        filter = event.args.open
          ? (_action: Action) =>
              _action.name === OpenMissionAction ||
              getWeb3Info(
                context.bot.leaderContract.platform,
                context.bot.leaderContract.version,
              ).isOpenMissionAction(_action)
          : (_action: Action) =>
              _action.name === CloseMissionAction ||
              getWeb3Info(
                context.bot.leaderContract.platform,
                context.bot.leaderContract.version,
              ).isCloseMissionAction(_action);

        status = TaskStatus.Initiated;
      }

      if (missionEventNames.includes(action.name)) {
        filter = isOpenMissionAction(action)
          ? (_action: Action) =>
              _action.name === OpenMissionAction ||
              getWeb3Info(
                context.bot.leaderContract.platform,
                context.bot.leaderContract.version,
              ).isOpenMissionAction(_action)
          : (_action: Action) =>
              _action.name === CloseMissionAction ||
              getWeb3Info(
                context.bot.leaderContract.platform,
                context.bot.leaderContract.version,
              ).isCloseMissionAction(_action);

        status = TaskStatus.Completed;
      }

      if (updateEventNames.includes(action.name)) {
        filter = (leaderAction: Action) => {
          if (context.bot.leaderContract.platform === 'GMX') {
            if (
              action.name === positionSizeIncreaseExecutedEventParser.eventName
            ) {
              return (
                leaderAction.name === positionIncreaseEventParser.eventName
              );
            }

            if (
              action.name === positionSizeDecreaseExecutedEventParser.eventName
            ) {
              return (
                leaderAction.name === positionDecreaseEventParser.eventName
              );
            }

            return false;
          } else {
            return isSameUpdateAction(leaderAction, action);
          }
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

      const task =
        missionTasks.length > 0 ? missionTasks[missionTasks.length - 1] : null;

      if (!task) {
        if (
          missionEventNames.includes(action.name) &&
          isCloseMissionAction(action)
        ) {
          closeActions.push({ action, context });

          const newAction = await this.actionsService.createCloseMissionAction(
            action.address,
            context.mission.targetPositionKey,
            '0',
          );

          const newTasks = await this.tasksService.createMany([
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
            details: `Unexpected app error: There are two open mission tasks for one mission, or no open mission missionTasks: ==> ${JSON.stringify(
              missionTasks,
            )}`,
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
        item.address,
        item.targetPositionKey,
        currentPrice.toString(),
      );

      await this.tasksService.createMany([
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

    await this.tasksService.updateMany(taskUpateInputs);
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
}
