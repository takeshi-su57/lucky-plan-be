import { Inject, Injectable } from '@nestjs/common';
import { MissionStatus, TaskStatus } from 'generated/prisma/client';
import { ClientProxy } from '@nestjs/microservices';

import {
  isOpenMissionAction,
  missionEventParsers,
} from 'src/web3/platform/gns/v10/eventParsers';
import { OpenMissionActionArgs } from 'src/types';
import { TaskDetails, TaskBackwardDetails } from './entities/task.entity';
import { TaskCreateInput, TaskUpdateInput } from './dto/task.input';

import { PATTERNS, SERVICE_NAMES } from 'src/utils/constants';

import { Mission } from 'src/microservices/apiService/modules/missions/entities/mission.entity';

import { ActionsService } from 'src/microservices/apiService/modules/actions/actions.service';
import { PrismaService } from 'src/global/prisma.service';
import { GnsService } from 'src/web3/platform/gns/gns.service';
import { getWeb3Info } from 'src/web3/utils';

@Injectable()
export class TasksService {
  constructor(
    @Inject(SERVICE_NAMES.REDIS_SERVICE) private redisClient: ClientProxy,
    private prismaService: PrismaService,
    private gnsService: GnsService,
    private actionsService: ActionsService,
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
      openEvent.args.t.user,
      mission.targetPositionKey,
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

      if (
        getWeb3Info(
          task.mission.bot.leaderContract.platform,
          task.mission.bot.leaderContract.version,
        ).isOpenMissionAction(task.action)
      ) {
        openTask = task;
      }
    }

    return openTask;
  }

  async cloneOpenTask(
    task: TaskDetails,
    clonedMissionId: number,
    args: OpenMissionActionArgs,
  ) {
    const clonedAction = await this.actionsService.createOpenMissionAction(
      task.action.address.toLowerCase(),
      task.action.positionKey,
      args,
      task.action.blockNumber,
      task.action.orderInBlock,
    );

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

  async createMany(inputs: TaskCreateInput[]) {
    if (inputs.length === 0) {
      return [];
    }

    await this.prismaService.task.createMany({
      data: inputs,
      skipDuplicates: true,
    });

    const newTasks = await this.prismaService.task.findMany({
      where: {
        OR: inputs.map((input) => ({
          missionId: input.missionId,
          actionId: input.actionId,
        })),
      },
      include: {
        action: true,
        mission: true,
      },
      orderBy: [{ actionId: 'asc' }, { id: 'asc' }],
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

  async getTasksByMissionMap(missionIds: number[]) {
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
          },
        },
      },
    });
  }
}
