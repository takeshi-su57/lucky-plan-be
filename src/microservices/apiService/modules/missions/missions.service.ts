import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { Address, isAddressEqual } from 'viem';
import { BotStatus, MissionStatus } from '@prisma/client';

import {
  getOrderIdFromMissionAction,
  isOpenMissionAction,
  missionEventNames,
  missionEventParsers,
} from 'src/microservices/web3Service/platform/gns/v10/eventParsers';

import { ActionContext, BotContext, MissionContext } from 'src/types';
import {
  MissionDetails,
  MissionBackwardDetails,
  ManualParams,
} from './entities/mission.entity';
import {
  MissionCloseInput,
  MissionCreateInput,
  MissionUpdateInput,
} from './dto/mission.input';
import {
  MIN_POSITION_SIZE,
  PATTERNS,
  SERVICE_NAMES,
} from 'src/utils/constants';

import { PrismaService } from 'src/global/prisma.service';
import { TasksService } from 'src/microservices/apiService/modules/tasks/tasks.service';
import { GnsService } from 'src/global/gns.service';
import { LogsService } from 'src/global/logs.service';

import { getOpenMissionParams } from 'src/microservices/apiService/modules/strategy/strategy-library';
import { getReadableError } from 'src/utils';

@Injectable()
export class MissionsService {
  constructor(
    @Inject(SERVICE_NAMES.REDIS_SERVICE) private redisClient: ClientProxy,
    private prismaService: PrismaService,
    private tasksService: TasksService,
    private gnsService: GnsService,
    private readonly logger: LogsService,
  ) {}

  private async getMissions(ids: number[]): Promise<MissionBackwardDetails[]> {
    return await this.prismaService.mission.findMany({
      where: {
        id: { in: ids },
      },
      include: {
        targetPosition: true,
        achievePosition: true,
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
    });
  }

  private async createMany(
    inputs: MissionCreateInput[],
    missionsByBotMap: Map<number, MissionDetails[]>,
  ) {
    if (inputs.length === 0) {
      return [];
    }

    const newMissions = await this.prismaService.mission.createManyAndReturn({
      data: inputs.map((input) => ({
        ...input,
        status: MissionStatus.Created,
      })),
      include: {
        targetPosition: true,
        achievePosition: true,
        bot: true,
      },
    });

    newMissions.forEach((mission) => {
      const arr = missionsByBotMap.get(mission.botId);

      if (arr) {
        arr.push(mission);
      } else {
        missionsByBotMap.set(mission.botId, [mission]);
      }
    });

    const missions = await this.getMissions(
      newMissions.map((mission) => mission.id),
    );

    await this.redisClient.emit(PATTERNS.Missions.MissionCreated, missions);

    return missions;
  }

  private async updateMany(inputs: MissionUpdateInput[]) {
    if (inputs.length === 0) {
      return [];
    }

    const updatedMissions = await this.prismaService.$transaction(
      inputs.map((input) => {
        return this.prismaService.mission.update({
          where: {
            id: input.id,
          },
          data: input,
          include: {
            targetPosition: true,
            achievePosition: true,
            bot: true,
          },
        });
      }),
    );

    const missions = await this.getMissions(
      updatedMissions.map((mission) => mission.id),
    );

    await this.redisClient.emit(PATTERNS.Missions.MissionUpdated, missions);

    return updatedMissions;
  }

  async attachAchievePositionMany(
    inputs: MissionUpdateInput[],
    missionsByBotMap: Map<number, MissionDetails[]>,
  ) {
    const updatedMissions = await this.updateMany(inputs);

    updatedMissions.forEach((item) => {
      const arr = missionsByBotMap.get(item.botId);

      if (arr) {
        const index = arr.findIndex((bot) => bot.id === item.id);
        arr[index] = item;
      } else {
        missionsByBotMap.set(item.botId, [item]);
      }
    });
  }

  async closeMany(
    inputs: MissionCloseInput[],
    missionsByBotMap: Map<number, MissionDetails[]>,
  ) {
    const closedMissions = await this.updateMany(
      inputs.map((item) => ({ ...item, status: MissionStatus.Closed })),
    );

    closedMissions.forEach((mission) => {
      const arr = missionsByBotMap.get(mission.botId);

      if (arr) {
        missionsByBotMap.set(
          mission.botId,
          arr.filter((item) => item.id !== mission.id),
        );
      }
    });
  }

  private async loadMissions() {
    const missionsByBotMap = new Map<number, MissionDetails[]>();

    const missions = await this.prismaService.mission.findMany({
      where: {
        status: {
          notIn: [MissionStatus.Closed, MissionStatus.Ignored],
        },
      },
      include: {
        targetPosition: true,
        achievePosition: true,
        bot: true,
      },
    });

    missions.forEach((mission) => {
      const arr = missionsByBotMap.get(mission.botId);

      if (arr) {
        arr.push(mission);
      } else {
        missionsByBotMap.set(mission.botId, [mission]);
      }
    });

    return missionsByBotMap;
  }

  async closeMission(
    userId: string,
    id: number,
    isForce: boolean,
  ): Promise<boolean> {
    const mission = await this.prismaService.mission.findUnique({
      where: {
        id,
        bot: {
          plan: {
            userId,
          },
        },
      },
      include: {
        targetPosition: true,
        achievePosition: true,
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
    });

    if (!mission) {
      throw new Error('Invalid mission id!');
    }

    if (
      mission.status === MissionStatus.Closed ||
      mission.status === MissionStatus.Ignored
    ) {
      throw new Error('Invalid mission status!');
    }

    const isClosed = await this.tasksService.closeMissionTasks(
      mission,
      isForce,
    );

    if (isClosed === 'awaiting') {
      throw new Error(
        'This mission cannot stop because there are pending transaction',
      );
    }

    if (isClosed === 'closed') {
      await this.updateMany([{ id: mission.id, status: MissionStatus.Closed }]);

      return true;
    }

    const closingMissions = await this.updateMany([
      {
        id: mission.id,
        status: MissionStatus.Closing,
      },
    ]);

    if (closingMissions.length !== 1) {
      throw new Error('There is something wrong while closing mission tasks!');
    }

    return true;
  }

  private async _cloneMission(
    mission: MissionDetails,
    missionsByBotMap: Map<number, MissionDetails[]>,
    manualParams?: ManualParams,
  ): Promise<boolean> {
    try {
      const openTask = await this.tasksService.findOpenTask(mission);

      if (!openTask) {
        throw new Error('Cannot clone because of missing open task!');
      }

      const clonedMission = await this.createMany(
        [
          {
            botId: mission.botId,
            targetPositionId: mission.targetPositionId,
          },
        ],
        missionsByBotMap,
      );

      if (clonedMission.length !== 1) {
        throw new Error('Cannot clone mission by internal error!');
      }

      await this.tasksService.cloneOpenTask(
        openTask,
        clonedMission[0].id,
        manualParams,
      );

      return true;
    } catch (error) {
      this.logger.log({
        severity: 'Error',
        summary: 'MissionsService>_cloneMission',
        details: `Cannot clone mission: ${getReadableError(error)}`,
      });

      return false;
    }
  }

  async cloneMission(userId: string, id: number, manualParams?: ManualParams) {
    const mission = await this.prismaService.mission.findUnique({
      where: {
        id,
        bot: {
          plan: {
            userId,
          },
        },
      },
      include: {
        targetPosition: true,
        achievePosition: true,
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
    });

    if (!mission) {
      throw new Error('Invalid mission id!');
    }

    return await this._cloneMission(mission, new Map(), manualParams);
  }

  async ignoreMission(userId: string, id: number): Promise<boolean> {
    const currentMission = await this.prismaService.mission.findUnique({
      where: {
        id,
        bot: {
          plan: {
            userId,
          },
        },
      },
    });

    if (!currentMission) {
      throw new Error('Invalid mission id!');
    }

    const ignoredMissions = await this.updateMany([
      { id, status: MissionStatus.Ignored },
    ]);

    if (ignoredMissions.length !== 1) {
      throw new Error('There is something wrong while ignoring mission tasks!');
    }

    const mission = await this.prismaService.mission.findUnique({
      where: {
        id,
      },
      include: {
        targetPosition: true,
        achievePosition: true,
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
    });

    if (!mission) {
      throw new Error('Invalid mission id!');
    }

    return true;
  }

  private async handleMissionLeaderActions(
    actions: ActionContext<BotContext>[],
    missionsByBotMap: Map<number, MissionDetails[]>,
  ) {
    const openEvents = actions
      .filter(
        (item) =>
          isOpenMissionAction(item.action) &&
          item.context.bot.status === BotStatus.Live,
      )
      // block leader action register if there is no pair ready
      .filter((item) => {
        const event = missionEventParsers
          .find((parser) => parser.eventName === item.action.name)!
          .actionParser(item.action);
        const { t, collateralPriceUsd } = event.args;

        const pair = this.gnsService.getPair(
          item.context.bot.followerContractId,
          t.pairIndex,
        );

        if (!pair) {
          return false;
        }

        const collateral = this.gnsService.getCollateral(
          item.context.bot.leaderContractId,
          t.collateralIndex,
        );

        if (!collateral) {
          return false;
        }

        const openMissionParams = getOpenMissionParams(
          item.context.bot.strategy,
          {
            leverage: t.leverage,
            collateralAmount: BigInt(t.collateralAmount),
            collateralPriceUsd: BigInt(collateralPriceUsd),
            collateral,
          },
          item.context.bot.leaderCollateralBaseline,
          100_000_000n,
          t.pairIndex,
        );

        // block leader action register if collateral is less than 25 USDC
        if (openMissionParams.collateralAmount < MIN_POSITION_SIZE) {
          return false;
        }

        return true;
      });

    await this.createMany(
      openEvents.map((item) => ({
        botId: item.context.bot.id,
        targetPositionId: item.action.positionId,
      })),
      missionsByBotMap,
    );
  }

  private getMissionActions(
    missionsByBotMap: Map<number, MissionDetails[]>,
    actions: ActionContext<BotContext>[],
    field: 'targetPosition' | 'achievePosition',
  ): ActionContext<MissionContext>[] {
    return actions
      .map((actionItem) => {
        const missions = missionsByBotMap.get(actionItem.context.bot.id) || [];

        let actionPosition = {
          address: actionItem.action.position.address.toLowerCase(),
          index: actionItem.action.position.index,
        };

        if (
          field === 'achievePosition' &&
          isOpenMissionAction(actionItem.action)
        ) {
          const orderId = getOrderIdFromMissionAction(actionItem.action);

          if (!orderId) {
            return [];
          }

          actionPosition = {
            address: orderId.user.toLowerCase(),
            index: orderId.index,
          };
        }

        const filteredMissions = missions.filter(
          (missionItem) =>
            !!missionItem[field] &&
            isAddressEqual(
              missionItem[field].address as Address,
              actionPosition.address as Address,
            ) &&
            missionItem[field].index === actionPosition.index,
        );

        return filteredMissions.map((mission) => ({
          ...actionItem,
          context: {
            ...actionItem.context,
            mission,
          },
        }));
      })
      .flat();
  }

  private async handleFollowerActions(
    missionsByBotMap: Map<number, MissionDetails[]>,
    followerActions: ActionContext<BotContext>[],
  ) {
    const missionActions = this.getMissionActions(
      missionsByBotMap,
      followerActions,
      'achievePosition',
    );

    // handle open mission follower actions
    await this.attachAchievePositionMany(
      missionActions
        .filter((item) => isOpenMissionAction(item.action))
        .map((item) => ({
          id: item.context.mission.id,
          achievePositionId: item.action.positionId,
          status: MissionStatus.Opened,
        })),
      missionsByBotMap,
    );

    if (missionActions.length > 0) {
      await this.tasksService.handleFollowerActions(missionActions, {
        closeCancelded: async (missionIds) => {
          // handle close mission follower actions
          await this.closeMany(
            missionIds.map((item) => ({
              id: item,
            })),
            missionsByBotMap,
          );
        },
        openCanceled: async (missionIds) => {
          await this.closeMany(
            missionIds.map((item) => ({
              id: item,
            })),
            missionsByBotMap,
          );
        },
        clone: async (missions) => {
          for (const mission of missions) {
            await this._cloneMission(mission, missionsByBotMap);
          }
        },
      });
    }
  }

  private async handleLeaderActions(
    missionsByBotMap: Map<number, MissionDetails[]>,
    leaderActions: ActionContext<BotContext>[],
  ) {
    await this.handleMissionLeaderActions(
      leaderActions.filter((item) =>
        missionEventNames.includes(item.action.name),
      ),
      missionsByBotMap,
    );

    const missionActions = this.getMissionActions(
      missionsByBotMap,
      leaderActions,
      'targetPosition',
    );

    if (missionActions.length > 0) {
      await this.tasksService.handleLeaderActions(
        missionActions.filter(
          (item) =>
            item.context.mission.status !== MissionStatus.Closing &&
            item.context.mission.status !== MissionStatus.Closed &&
            item.context.mission.status !== MissionStatus.Ignored,
        ),
        async (missionIds) => {
          // handle close mission follower actions
          await this.closeMany(
            missionIds.map((item) => ({
              id: item,
            })),
            missionsByBotMap,
          );
        },
      );
    }
  }

  async handleActions(
    followerActions: ActionContext<BotContext>[],
    leaderActions: ActionContext<BotContext>[],
  ) {
    const missionsByBotMap = await this.loadMissions();

    if (followerActions.length > 0) {
      await this.handleFollowerActions(missionsByBotMap, followerActions);
    }

    if (leaderActions.length > 0) {
      await this.handleLeaderActions(missionsByBotMap, leaderActions);
    }
  }
}
