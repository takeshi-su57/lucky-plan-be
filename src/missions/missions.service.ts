import { Inject, Injectable } from '@nestjs/common';
import { BotStatus, MissionStatus } from '@prisma/client';
import { Address, isAddressEqual } from 'viem';
import { PubSub } from 'graphql-subscriptions';

import {
  getOrderIdFromMissionAction,
  isOpenMissionAction,
  missionEventNames,
  missionEventParsers,
} from 'src/actions/eventParsers';

import {
  MarketOrderInitiatedEventArgs,
  marketOrderInitiatedEventParser,
} from 'src/actions/eventParsers/market-order-initiated.parser';
import { PUB_SUB } from 'src/global/global.module';

import { PrismaService } from 'src/global/prisma.service';
import { TasksService } from 'src/tasks/tasks.service';
import {
  ActionContext,
  BotContext,
  TradeEventContext,
  MissionContext,
} from 'src/types';
import {
  MissionDetails,
  MissionBackwardDetails,
} from './entities/mission.entity';
import {
  MissionCloseInput,
  MissionCreateInput,
  MissionUpdateInput,
} from './dto/mission.input';
import { MIN_POSITION_SIZE, SUBSCRIPTION_TOKEN } from 'src/utils/constants';
import { TradingVariableService } from 'src/global/trading-variable.service';
import { LogsService } from 'src/loggers/logs.service';
import { getOpenMissionParams } from 'src/strategy/strategy-library';

@Injectable()
export class MissionsService {
  constructor(
    @Inject(PUB_SUB) private readonly pubSub: PubSub,
    private prismaService: PrismaService,
    private tasksService: TasksService,
    private tradingVariableService: TradingVariableService,
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

    this.pubSub.publish(SUBSCRIPTION_TOKEN.missionCreated, {
      [SUBSCRIPTION_TOKEN.missionCreated]: missions,
    });

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

    this.pubSub.publish(SUBSCRIPTION_TOKEN.missionUpdated, {
      [SUBSCRIPTION_TOKEN.missionUpdated]: missions,
    });

    return updatedMissions;
  }

  private async attachAchievePositionMany(
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

  async cloneMission(userId: string, id: number) {
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
      new Map(),
    );

    if (clonedMission.length !== 1) {
      throw new Error('Cannot clone mission by internal error!');
    }

    await this.tasksService.cloneOpenTask(openTask, clonedMission[0].id);

    return true;
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

  private async handleMarketOrderInitiatedActions(
    missionsByBotMap: Map<number, MissionDetails[]>,
    followerActions: ActionContext<BotContext>[],
  ) {
    const openEvents = followerActions
      .map((item) => ({
        action: item.action,
        event: marketOrderInitiatedEventParser.actionParser(item.action),
        context: item.context,
      }))
      .filter((item) => item.event.args.open);

    const eventsMap = new Map<
      number,
      TradeEventContext<MarketOrderInitiatedEventArgs, BotContext>
    >();

    openEvents.forEach((event) => {
      if (eventsMap.get(event.context.bot.id)) {
        this.logger.log({
          severity: 'Warning',
          summary: 'MissionsService>handleMarketOrderInitiatedActions',
          details:
            'Unexpected app error: There are two MarketOrderInitiated events having same bot id',
        });
      }

      eventsMap.set(event.context.bot.id, event);
    });

    // find missions by their setup task.
    const tasks = await this.tasksService.findMissionTasksForMOIEvent(
      Array.from(eventsMap.keys()),
    );

    // fill achievePositionId with orderId for temporaily
    await this.attachAchievePositionMany(
      tasks
        .map((task) => {
          const mission = task.mission;
          const botId = mission.botId;
          const eventContext = eventsMap.get(botId);

          if (!eventContext) {
            this.logger.log({
              severity: 'Warning',
              summary: 'MissionsService>handleMarketOrderInitiatedActions',
              details:
                'Unexpected app error: eventContext = eventsByBotId[botId] <- no eventContet',
            });

            return null;
          }

          return {
            id: mission.id,
            achievePositionId: eventContext.action.positionId,
            status: MissionStatus.Opening,
          };
        })
        .filter((item) => !!item),
      missionsByBotMap,
    );
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

        const pair = this.tradingVariableService.getPair(
          item.context.bot.followerContractId,
          t.pairIndex,
        );

        if (!pair) {
          return false;
        }

        const collateral = this.tradingVariableService.getCollateral(
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
            return null;
          }

          actionPosition = {
            address: orderId.user.toLowerCase(),
            index: orderId.index,
          };
        }

        const mission = missions.find(
          (missionItem) =>
            !!missionItem[field] &&
            isAddressEqual(
              missionItem[field].address as Address,
              actionPosition.address as Address,
            ) &&
            missionItem[field].index === actionPosition.index,
        );

        if (!mission) {
          return null;
        }

        return {
          ...actionItem,
          context: {
            ...actionItem.context,
            mission,
          },
        };
      })
      .filter((item) => !!item);
  }

  private async handleFollowerActions(
    missionsByBotMap: Map<number, MissionDetails[]>,
    followerActions: ActionContext<BotContext>[],
  ) {
    await this.handleMarketOrderInitiatedActions(
      missionsByBotMap,
      followerActions.filter(
        (item) =>
          item.action.name === marketOrderInitiatedEventParser.eventName,
      ),
    );

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
      await this.tasksService.handleFollowerActions(
        missionActions,
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
