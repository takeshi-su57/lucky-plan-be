import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  MissionMode,
  MissionStatus,
  Platform,
  StrategyMode,
} from 'generated/prisma/client';

import { missionEventParsers } from 'src/web3/platform/gns/v10/eventParsers';
import { missionEventParsers as avntMissionEventParsers } from 'src/web3/platform/avnt/v1/eventParsers';
import { eventParsers as gmxEventParsers } from 'src/web3/platform/gmx/v2/eventParsers';

import { ActionContext, BotContext, OpenMissionActionArgs } from 'src/types';
import {
  Mission,
  MissionBackwardDetails,
  ManualParams,
} from './entities/mission.entity';
import {
  MissionCloseInput,
  MissionCreateInput,
  MissionUpdateInput,
} from './dto/mission.input';
import { PATTERNS, SERVICE_NAMES } from 'src/utils/constants';

import { PrismaService } from 'src/global/prisma.service';
import { TasksService } from 'src/microservices/apiService/modules/tasks/tasks.service';
import { LogsService } from 'src/global/logs.service';

import { getOpenMissionParams } from 'src/microservices/apiService/modules/strategy/strategy-library';
import { getReadableError } from 'src/utils';

import { getMarketInfo, getTokenInfo } from 'src/web3/platform/gmx/v2/configs';
import {
  getCollateral,
  getPairIndex,
  getPair,
} from 'src/web3/platform/gns/v10/configs';
import { getPairName as getAvntPairName } from 'src/web3/platform/avnt/v1/configs';
import { GnsService } from 'src/web3/platform/gns/gns.service';

const MAX_OPEN_MISSIONS_KEY = 'max_open_missions';

export function parseSelectedPairs(
  str: string,
): { pair: string; isLong: boolean }[] {
  try {
    const selectedPairs = JSON.parse(str);

    if (!Array.isArray(selectedPairs)) {
      return [];
    }

    return selectedPairs
      .map((item: { pair: string; isLong: boolean } | string) =>
        typeof item === 'string'
          ? [
              {
                pair: item.toLowerCase(),
                isLong: true,
              },
              {
                pair: item.toLowerCase(),
                isLong: false,
              },
            ]
          : [
              {
                pair: item.pair.toLowerCase(),
                isLong: item.isLong,
              },
            ],
      )
      .flat();
  } catch {
    return [];
  }
}

@Injectable()
export class MissionsService {
  constructor(
    @Inject(SERVICE_NAMES.REDIS_SERVICE) private redisClient: ClientProxy,
    private prismaService: PrismaService,
    private tasksService: TasksService,
    private gnsService: GnsService,
    private readonly logger: LogsService,
  ) {}

  async updateMaxOpenMissions(maxCount: number) {
    await this.prismaService.metadata.upsert({
      where: { key: MAX_OPEN_MISSIONS_KEY },
      update: { value: maxCount.toString() },
      create: { key: MAX_OPEN_MISSIONS_KEY, value: maxCount.toString() },
    });
  }

  async getMaxOpenMissions() {
    const maxOpenMissions = await this.prismaService.metadata.findUnique({
      where: { key: MAX_OPEN_MISSIONS_KEY },
    });

    return maxOpenMissions?.value ? Number(maxOpenMissions.value) : 0;
  }

  async getMissions(ids: number[]): Promise<MissionBackwardDetails[]> {
    return await this.prismaService.mission.findMany({
      where: {
        id: { in: ids },
      },
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
    });
  }

  async emitMissionCreated(missions: MissionBackwardDetails[]) {
    if (missions.length === 0) {
      return;
    }

    await this.redisClient.emit(PATTERNS.Missions.MissionCreated, missions);
  }

  async createMany(
    inputs: MissionCreateInput[],
    missionsByBotMap: Map<number, Mission[]>,
  ) {
    if (inputs.length === 0) {
      return [];
    }

    const existingMissions = await this.prismaService.mission.findMany({
      where: {
        OR: inputs.map((input) => ({
          botId: input.botId,
          targetPositionBlockNumber: input.targetPositionBlockNumber,
          targetPositionLogIndex: input.targetPositionLogIndex,
        })),
      },
      select: {
        botId: true,
        targetPositionBlockNumber: true,
        targetPositionLogIndex: true,
      },
    });

    const existingKeys = new Set(
      existingMissions.map(
        (mission) =>
          `${mission.botId}:${mission.targetPositionBlockNumber}:${mission.targetPositionLogIndex}`,
      ),
    );

    const createInputs = inputs.filter(
      (input) =>
        !existingKeys.has(
          `${input.botId}:${input.targetPositionBlockNumber}:${input.targetPositionLogIndex}`,
        ),
    );

    if (createInputs.length > 0) {
      await this.prismaService.mission.createMany({
        data: createInputs.map((input) => ({
          ...input,
          status: MissionStatus.Created,
        })),
      });
    }

    const newMissions = await this.prismaService.mission.findMany({
      where: {
        OR: inputs.map((input) => ({
          botId: input.botId,
          targetPositionBlockNumber: input.targetPositionBlockNumber,
          targetPositionLogIndex: input.targetPositionLogIndex,
        })),
      },
      include: {
        bot: true,
      },
      orderBy: [
        { targetPositionBlockNumber: 'asc' },
        { targetPositionLogIndex: 'asc' },
        { id: 'asc' },
      ],
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

    await this.emitMissionCreated(missions);

    return missions;
  }

  async updateMany(inputs: MissionUpdateInput[]) {
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
    missionsByBotMap: Map<number, Mission[]>,
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
    missionsByBotMap: Map<number, Mission[]>,
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

  async loadMissionsByBotIds(botIds: number[]) {
    const missionsByBotMap = new Map<number, Mission[]>();

    const missions = await this.prismaService.mission.findMany({
      where: {
        status: {
          notIn: [MissionStatus.Closed, MissionStatus.Ignored],
        },
        botId: {
          in: botIds,
        },
      },
      include: {
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

  async createOpenMissionWithLifetime(item: ActionContext<BotContext>) {
    return await this.prismaService.$transaction(async (tx) => {
      const existingMission = await tx.mission.findFirst({
        where: {
          botId: item.context.bot.id,
          targetPositionBlockNumber: item.action.blockNumber,
          targetPositionLogIndex: item.action.orderInBlock,
        },
        select: {
          id: true,
        },
      });

      if (existingMission) {
        return {
          missionId: existingMission.id,
          created: false,
          strategyUpdated: false,
        };
      }

      let mode: MissionMode = MissionMode.Signal;
      let strategyUpdated = false;

      if (item.context.bot.strategy.mode === StrategyMode.Default) {
        const consumed = await tx.strategy.updateMany({
          where: {
            id: item.context.bot.strategy.id,
            mode: StrategyMode.Default,
            lifeTime: {
              gt: 0,
            },
          },
          data: {
            lifeTime: {
              decrement: 1,
            },
          },
        });

        if (consumed.count > 0) {
          mode = MissionMode.Default;
          strategyUpdated = true;

          await tx.strategy.updateMany({
            where: {
              id: item.context.bot.strategy.id,
              mode: StrategyMode.Default,
              lifeTime: {
                lte: 0,
              },
            },
            data: {
              mode: StrategyMode.Signal,
            },
          });
        } else {
          const turnedOff = await tx.strategy.updateMany({
            where: {
              id: item.context.bot.strategy.id,
              mode: StrategyMode.Default,
              lifeTime: {
                lte: 0,
              },
            },
            data: {
              mode: StrategyMode.Signal,
            },
          });

          strategyUpdated = turnedOff.count > 0;
        }
      }

      const mission = await tx.mission.create({
        data: {
          botId: item.context.bot.id,
          targetPositionKey: item.action.positionKey,
          targetPositionBlockNumber: item.action.blockNumber,
          targetPositionLogIndex: item.action.orderInBlock,
          mode,
          status: MissionStatus.Created,
        },
      });

      return {
        missionId: mission.id,
        created: true,
        strategyUpdated,
      };
    });
  }

  async emitStrategyBotUpdates(strategyIds: number[]) {
    const uniqueStrategyIds = [...new Set(strategyIds)];

    if (uniqueStrategyIds.length === 0) {
      return;
    }

    const bots = await this.prismaService.bot.findMany({
      where: {
        strategyId: {
          in: uniqueStrategyIds,
        },
      },
      include: {
        follower: true,
        strategy: true,
        leaderContract: true,
        followerContract: true,
        plan: true,
      },
    });

    if (bots.length > 0) {
      await this.redisClient.emit(PATTERNS.Bots.BotUpdated, bots);
    }
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

  async _cloneMission(
    mission: Mission,
    missionsByBotMap: Map<number, Mission[]>,
    manualParams?: ManualParams,
  ): Promise<boolean> {
    try {
      const openTask = await this.tasksService.findOpenTask(mission);

      if (!openTask) {
        throw new Error('Cannot clone because of missing open task!');
      }

      const bot = await this.prismaService.bot.findUnique({
        where: {
          id: mission.botId,
        },
        include: {
          leaderContract: true,
          followerContract: true,
          strategy: true,
        },
      });

      if (!bot) {
        throw new Error('Cannot clone mission by internal error!');
      }

      let openArgs: OpenMissionActionArgs | null = null;

      switch (bot.leaderContract.platform) {
        case Platform.GNS: {
          const openEvent = missionEventParsers
            .find((parser) => parser.eventName === openTask.action.name)!
            .actionParser(openTask.action);
          const { t, collateralPriceUsd } = openEvent.args;

          const currentPrice = await this.gnsService.getPairPrice(t.pairIndex);

          const collateral = getCollateral(
            bot.leaderContract.chainId,
            t.collateralIndex,
          );

          if (!collateral) {
            throw new Error(
              `leader contract doesn't support this collateral index: ${t.collateralIndex}`,
            );
          }

          const openMissionParams = manualParams
            ? {
                collateralAmount: manualParams.collateralAmount,
                leverage: manualParams.leverage,
                long: manualParams.long,
                openPrice: currentPrice.toString(),
                sl: 0n.toString(),
                tp: 0n.toString(),
              }
            : {
                ...getOpenMissionParams(bot.strategy, {
                  leverage: t.leverage,
                  collateralAmount: BigInt(t.collateralAmount),
                  collateralPriceUsd: BigInt(collateralPriceUsd),
                  collateral,
                  isLong: t.long,
                  openPrice: currentPrice,
                  usdcPrice: 100_000_000n,
                  pairIndex: t.pairIndex,
                }),
              };

          openArgs = {
            pairIndex: t.pairIndex,
            collateralAmountUSDC: openMissionParams.collateralAmount.toString(),
            leverage: openMissionParams.leverage,
            long: openMissionParams.long,
            openPrice: openMissionParams.openPrice.toString(),
            tp: openMissionParams.tp.toString(),
            sl: openMissionParams.sl.toString(),
          };

          break;
        }
        case Platform.GMX: {
          const gmxEvent = gmxEventParsers
            .find((parser) => parser.eventName === openTask.action.name)!
            .actionParser(openTask.action);

          const marketInfo = getMarketInfo(
            bot.leaderContract.chainId,
            gmxEvent.args.market,
          );

          const collateral = getTokenInfo(
            bot.leaderContract.chainId,
            gmxEvent.args.collateralToken,
          );

          if (!marketInfo || !collateral) {
            throw new Error(
              `Current gmx configuration doesn't support this market: ${gmxEvent.args.market} on chain ${bot.leaderContract.chainId}`,
            );
          }

          const pairName =
            `${marketInfo.indexToken.baseSymbol || marketInfo.indexToken.symbol}/usd`.toLowerCase();

          const pairIndex = getPairIndex(
            bot.followerContract.chainId,
            pairName,
          );

          if (pairIndex === -1) {
            throw new Error(
              `follower contract doesn't support this pairName: ${pairName}`,
            );
          }

          const pair = getPair(bot.followerContract.chainId, pairIndex);

          if (!pair) {
            throw new Error(
              `follower contract doesn't support this pairName: ${pairName}`,
            );
          }

          const currentPrice = await this.gnsService.getPairPrice(pairIndex);

          const sizeInUsd = Number(gmxEvent.args.sizeInUsd) / 1e30;
          const collateralInUsd =
            (Number(gmxEvent.args.collateralAmount) *
              Number(gmxEvent.args['collateralTokenPrice.max'])) /
            1e30;

          const leverage = Math.floor((sizeInUsd / collateralInUsd) * 1e3);

          const openMissionParams = manualParams
            ? {
                collateralAmount: manualParams.collateralAmount,
                leverage: manualParams.leverage,
                long: manualParams.long,
                openPrice: currentPrice.toString(),
                sl: 0n.toString(),
                tp: 0n.toString(),
              }
            : getOpenMissionParams(bot.strategy, {
                leverage,
                collateralAmount: BigInt(gmxEvent.args.collateralAmount),
                collateralPriceUsd: BigInt(
                  Math.floor(
                    Number(gmxEvent.args['collateralTokenPrice.max']) /
                      Math.pow(10, 30 - collateral.decimals - 8),
                  ),
                ),
                collateral: {
                  collateralIndex: 0,
                  isActive: true,
                  collateral: collateral.address as `0x${string}`,
                  precision: BigInt(Math.pow(10, collateral.decimals)),
                  precisionDelta: 0n,
                  __placeholder: 0n,
                },
                isLong: gmxEvent.args.isLong,
                openPrice: currentPrice,
                usdcPrice: 100_000_000n,
                pairIndex: pairIndex,
              });

          openArgs = {
            pairIndex,
            collateralAmountUSDC: openMissionParams.collateralAmount.toString(),
            leverage: openMissionParams.leverage,
            long: openMissionParams.long,
            openPrice: openMissionParams.openPrice.toString(),
            tp: openMissionParams.tp.toString(),
            sl: openMissionParams.sl.toString(),
          };

          break;
        }
        case Platform.AVNT: {
          const event = avntMissionEventParsers
            .find((parser) => parser.eventName === openTask.action.name)!
            .actionParser(openTask.action);
          const { t } = event.args;

          const pairName = getAvntPairName(Number(t.pairIndex));

          if (!pairName) {
            throw new Error(
              `Follower contract doesn't support this pair name: ${pairName}`,
            );
          }

          const pairIndex = getPairIndex(
            bot.followerContract.chainId,
            pairName,
          );

          if (pairIndex === -1) {
            throw new Error(
              `Follower contract doesn't support this pairIndex: ${pairIndex}`,
            );
          }

          const currentPrice = await this.gnsService.getPairPrice(pairIndex);

          const openMissionParams = manualParams
            ? {
                collateralAmount: manualParams.collateralAmount,
                leverage: manualParams.leverage,
                long: manualParams.long,
                openPrice: currentPrice.toString(),
                sl: 0n.toString(),
                tp: 0n.toString(),
              }
            : getOpenMissionParams(bot.strategy, {
                leverage: Math.floor(Number(t.leverage) / 1e7),
                collateralAmount: BigInt(t.initialPosToken),
                collateralPriceUsd: 100_000_000n,
                collateral: {
                  collateralIndex: 0,
                  isActive: true,
                  collateral:
                    `0x0000000000000000000000000000000000000000` as `0x${string}`,
                  precision: 1000_000n,
                  precisionDelta: 0n,
                  __placeholder: 0n,
                },
                isLong: t.buy,
                openPrice: currentPrice,
                usdcPrice: 100_000_000n,
                pairIndex,
              });

          openArgs = {
            pairIndex,
            collateralAmountUSDC: openMissionParams.collateralAmount.toString(),
            leverage: openMissionParams.leverage,
            long: openMissionParams.long,
            openPrice: openMissionParams.openPrice.toString(),
            tp: openMissionParams.tp.toString(),
            sl: openMissionParams.sl.toString(),
          };

          break;
        }
      }

      if (!openArgs) {
        throw new Error('Cannot clone mission by internal error!');
      }

      const clonedMission = await this.createMany(
        [
          {
            botId: mission.botId,
            targetPositionKey: mission.targetPositionKey,
            targetPositionBlockNumber: mission.targetPositionBlockNumber,
            targetPositionLogIndex: mission.targetPositionLogIndex,
            mode: MissionMode.Default,
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
        openArgs,
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
}
