import { Injectable, Logger } from '@nestjs/common';
import { MissionStatus } from '@prisma/client';
import {
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
import { Mission } from './entities/mission.entity';
import {
  MissionAttachAchievePositionInput,
  MissionCloseInput,
  MissionCreateInput,
  MissionUpdateInput,
} from './dto/mission.input';

@Injectable()
export class MissionsService {
  private missionsByBotMap = new Map<number, Mission[]>();

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
    return this.prismaService.$transaction(
      inputs.map((input) => {
        return this.prismaService.mission.update({
          where: {
            id: input.id,
          },
          data: input,
        });
      }),
    );
  }

  async attachAchievePositionMany(inputs: MissionAttachAchievePositionInput[]) {
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
        status: MissionStatus.Opened,
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

    this.attachAchievePositionMany(
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

    this.createMany(
      openEvents.map((item) => ({
        botId: item.context.bot.id,
        targetPositionId: item.action.positionId,
      })),
    );
  }

  async handleMissionFollowerActions(actions: ActionContext<MissionContext>[]) {
    const openEvents = actions
      .map((item) => ({
        action: item.action,
        context: item.context,
      }))
      .filter((item) => isCloseMissionAction(item.action));

    this.closeMany(
      openEvents.map((item) => ({
        id: item.context.mission.id,
      })),
    );
  }

  getMissionActions(
    actions: ActionContext<BotContext>[],
    field: 'targetPositionId' | 'achievePositionId',
  ): ActionContext<MissionContext>[] {
    return actions
      .map((actionItem) => {
        const missions =
          this.missionsByBotMap.get(actionItem.context.bot.id) || [];

        const mission = missions.filter(
          (missionItem) => missionItem[field] === actionItem.action.positionId,
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
    await this.handleMarketOrderInitiatedActions(
      followerActions.filter(
        (item) =>
          item.action.name === marketOrderInitiatedEventParser.eventName,
      ),
    );

    await this.handleMissionFollowerActions(
      this.getMissionActions(
        followerActions.filter((item) =>
          missionEventNames.includes(item.action.name),
        ),
        'achievePositionId',
      ),
    );

    const missionActions = this.getMissionActions(
      followerActions,
      'achievePositionId',
    );

    if (missionActions.length > 0) {
      this.tasksService.handleFollowerActions(missionActions);
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
      'targetPositionId',
    );

    if (missionActions.length > 0) {
      this.tasksService.handleLeaderActions(missionActions);
    }
  }
}
