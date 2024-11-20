import { Injectable, Logger } from '@nestjs/common';
import { MissionStatus } from '@prisma/client';
import {
  getOrderIdFromMissionAction,
  isCloseMissionAction,
  isOpenMissionAction,
  missionEventNames,
} from 'src/actions/eventParsers';

import {
  MarketOrderInitiatedEventArgs,
  marketOrderInitiatedEventParser,
} from 'src/actions/eventParsers/market-order-initiated.parser';

import { PrismaService } from 'src/global/prisma.service';
import { TasksService } from 'src/tasks/tasks.service';
import {
  ActionContext,
  BotContext,
  TradeEventContext,
  MissionContext,
} from 'src/types';
import { MissionShallowDetails } from './entities/mission.entity';
import {
  MissionAttachAchievePositionInput,
  MissionCloseInput,
  MissionCreateInput,
  MissionUpdateInput,
} from './dto/mission.input';
import { Address, isAddressEqual } from 'viem';

@Injectable()
export class MissionsService {
  private missionsByBotMap = new Map<number, MissionShallowDetails[]>();

  constructor(
    private prismaService: PrismaService,
    private tasksService: TasksService,
    private readonly logger: Logger,
  ) {
    this.loadMissions();
  }

  async createMany(inputs: MissionCreateInput[]) {
    const newMissions = await this.prismaService.mission.createManyAndReturn({
      data: inputs.map((input) => ({
        ...input,
        status: MissionStatus.Opened,
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
  }

  async updateMany(inputs: MissionUpdateInput[]) {
    return await this.prismaService.$transaction(
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
  }

  async attachAchievePositionMany(inputs: MissionAttachAchievePositionInput[]) {
    console.log('Attach achieve positions ===>', inputs);

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
    console.log('close missions ===>', inputs);

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
        status: MissionStatus.Opened,
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

  findAll() {
    return this.prismaService.mission.findMany();
  }

  findOne(id: number) {
    return this.prismaService.mission.findUnique({ where: { id } });
  }

  findByBot(botId: number) {
    return this.prismaService.mission.findMany({ where: { botId } });
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
    const tasks = this.tasksService.findMissionTasksForMOIEvent(
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
          };
        })
        .filter((item) => !!item),
    );
  }

  async handleMissionLeaderActions(actions: ActionContext<BotContext>[]) {
    const openEvents = actions
      .map((item) => ({
        action: item.action,
        context: item.context,
      }))
      .filter((item) => isOpenMissionAction(item.action));

    console.log(
      'find mission leader actions and create mission object',
      openEvents,
    );

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
          address: actionItem.action.position.address,
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
            address: orderId.user,
            index: orderId.index,
          };
        }

        const mission = missions.filter(
          (missionItem) =>
            !!missionItem[field] &&
            isAddressEqual(
              missionItem[field].address as Address,
              actionPosition.address as Address,
            ) &&
            missionItem[field].index === actionPosition.index,
        );

        if (mission.length === 0) {
          return null;
        }

        return {
          ...actionItem,
          context: {
            ...actionItem.context,
            mission: mission[0],
          },
        };
      })
      .filter((item) => !!item);
  }

  async handleFollowerActions(followerActions: ActionContext<BotContext>[]) {
    console.log('handleFollowerActions =>', followerActions);

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
        })),
    );

    if (missionActions.length > 0) {
      console.log(
        'handle follower actions in mission service ===>',
        JSON.stringify(missionActions, null, 2),
      );

      await this.tasksService.handleFollowerActions(missionActions);
    }

    // handle close mission follower actions
    await this.closeMany(
      missionActions
        .filter((item) => isCloseMissionAction(item.action))
        .map((item) => ({
          id: item.context.mission.id,
        })),
    );
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

    console.log('missionActions ==>', missionActions);

    if (missionActions.length > 0) {
      console.log(
        'handle leader actions in mission service ===>',
        missionActions.length,
      );

      await this.tasksService.handleLeaderActions(missionActions);
    }
  }
}
