import { Inject, Injectable, Logger } from '@nestjs/common';
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
  MissionShallowDetails,
  MissionWithTasks,
} from './entities/mission.entity';
import {
  MissionCloseInput,
  MissionCreateInput,
  MissionUpdateInput,
} from './dto/mission.input';
import { SUBSCRIPTION_TOKEN } from 'src/utils/constants';
import { TradingVariableService } from 'src/global/trading-variable.service';

@Injectable()
export class MissionsService {
  private missionsByBotMap = new Map<number, MissionShallowDetails[]>();

  constructor(
    @Inject(PUB_SUB) private readonly pubSub: PubSub,
    private prismaService: PrismaService,
    private tasksService: TasksService,
    private tradingVariableService: TradingVariableService,
    private readonly logger: Logger,
  ) {
    this.loadMissions();
  }

  async createMany(inputs: MissionCreateInput[]) {
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
      const arr = this.missionsByBotMap.get(mission.botId);

      if (arr) {
        arr.push(mission);
      } else {
        this.missionsByBotMap.set(mission.botId, [mission]);
      }
    });

    this.pubSub.publish(SUBSCRIPTION_TOKEN.missionAdded, {
      [SUBSCRIPTION_TOKEN.missionAdded]: newMissions,
    });
  }

  async updateMany(inputs: MissionUpdateInput[]) {
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

    this.pubSub.publish(SUBSCRIPTION_TOKEN.missionUpdated, {
      [SUBSCRIPTION_TOKEN.missionUpdated]: updatedMissions,
    });

    return updatedMissions;
  }

  getMissionsByBotId(botId: number) {
    return this.missionsByBotMap.get(botId) || [];
  }

  async attachAchievePositionMany(inputs: MissionUpdateInput[]) {
    const updatedMissions = await this.updateMany(inputs);

    updatedMissions.forEach((item) => {
      const arr = this.missionsByBotMap.get(item.botId);

      if (arr) {
        const index = arr.findIndex((bot) => bot.id === item.id);
        arr[index] = item;
      } else {
        this.missionsByBotMap.set(item.botId, [item]);
      }
    });
  }

  async closeMany(inputs: MissionCloseInput[]) {
    const closedMissions = await this.updateMany(
      inputs.map((item) => ({ ...item, status: MissionStatus.Closed })),
    );

    closedMissions.forEach((mission) => {
      const arr = this.missionsByBotMap.get(mission.botId);

      if (arr) {
        this.missionsByBotMap.set(
          mission.botId,
          arr.filter((item) => item.id !== mission.id),
        );
      }
    });
  }

  async loadMissions() {
    const missions = await this.prismaService.mission.findMany({
      where: {
        status: {
          not: MissionStatus.Closed,
        },
      },
      include: {
        targetPosition: true,
        achievePosition: true,
        bot: true,
      },
    });

    missions.forEach((mission) => {
      const arr = this.missionsByBotMap.get(mission.botId);

      if (arr) {
        arr.push(mission);
      } else {
        this.missionsByBotMap.set(mission.botId, [mission]);
      }
    });
  }

  async closeMission(id: number, isForce: boolean) {
    const mission = await this.prismaService.mission.findUnique({
      where: {
        id,
      },
      include: {
        targetPosition: true,
        achievePosition: true,
        bot: true,
      },
    });

    if (!mission) {
      throw new Error('Invalid mission id!');
    }

    if (mission.status === MissionStatus.Closed) {
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
      await this.closeMany([{ id: mission.id }]);

      return {
        ...mission,
        status: MissionStatus.Closed,
      };
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

    const closingMission = closingMissions[0];

    const arr = this.missionsByBotMap.get(closingMission.botId);

    if (arr) {
      const index = arr.findIndex((bot) => bot.id === closingMission.id);
      arr[index] = closingMission;
    } else {
      this.missionsByBotMap.set(closingMission.botId, [closingMission]);
    }

    return closingMission;
  }

  findAll() {
    return this.prismaService.mission.findMany({
      include: {
        targetPosition: true,
        achievePosition: true,
        bot: true,
      },
    });
  }

  findOne(id: number): Promise<MissionWithTasks | null> {
    return this.prismaService.mission.findUnique({
      where: { id },
      include: {
        tasks: {
          include: {
            action: true,
            mission: true,
          },
        },
      },
    });
  }

  async handleMarketOrderInitiatedActions(
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
        this.logger.warn(
          'Unexpected app error: There are two MarketOrderInitiated events having same bot id',
        );
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
            this.logger.warn(
              'Unexpected app error: eventContext = eventsByBotId[botId] <- no eventContet',
            );

            return null;
          }

          return {
            id: mission.id,
            achievePositionId: eventContext.action.positionId,
            status: MissionStatus.Opening,
          };
        })
        .filter((item) => !!item),
    );
  }

  async handleMissionLeaderActions(actions: ActionContext<BotContext>[]) {
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
        const { t } = event.args;

        const pair = this.tradingVariableService.getPair(
          item.context.bot.followerContractId,
          t.pairIndex,
        );

        return !!pair;
      });

    await this.createMany(
      openEvents.map((item) => ({
        botId: item.context.bot.id,
        targetPositionId: item.action.positionId,
      })),
    );
  }

  getMissionActions(
    actions: ActionContext<BotContext>[],
    field: 'targetPosition' | 'achievePosition',
  ): ActionContext<MissionContext>[] {
    return actions
      .map((actionItem) => {
        const missions =
          this.missionsByBotMap.get(actionItem.context.bot.id) || [];

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

  async handleFollowerActions(followerActions: ActionContext<BotContext>[]) {
    await this.handleMarketOrderInitiatedActions(
      followerActions.filter(
        (item) =>
          item.action.name === marketOrderInitiatedEventParser.eventName,
      ),
    );

    const missionActions = this.getMissionActions(
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
          );
        },
      );
    }
  }

  async handleLeaderActions(leaderActions: ActionContext<BotContext>[]) {
    await this.handleMissionLeaderActions(
      leaderActions.filter((item) =>
        missionEventNames.includes(item.action.name),
      ),
    );

    const missionActions = this.getMissionActions(
      leaderActions,
      'targetPosition',
    );

    if (missionActions.length > 0) {
      await this.tasksService.handleLeaderActions(
        missionActions.filter(
          (item) =>
            item.context.mission.status !== MissionStatus.Closing &&
            item.context.mission.status !== MissionStatus.Closed,
        ),
        async (missionIds) => {
          // handle close mission follower actions
          await this.closeMany(
            missionIds.map((item) => ({
              id: item,
            })),
          );
        },
      );
    }
  }
}
