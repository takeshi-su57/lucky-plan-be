import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  BotStatus,
  MissionMode,
  MissionStatus,
  Platform,
} from '@prisma/client';

import {
  getOrderIdFromMissionAction,
  missionEventParsers,
} from 'src/web3/platform/gns/v10/eventParsers';
import {
  missionEventParsers as avntMissionEventParsers,
  missionEventNames as avntMissionEventNames,
} from 'src/web3/platform/avnt/v1/eventParsers';
import { eventParsers as gmxEventParsers } from 'src/web3/platform/gmx/v2/eventParsers';

import {
  ActionContext,
  BotContext,
  MissionContext,
  OpenMissionActionArgs,
} from 'src/types';
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
import {
  MIN_POSITION_SIZE,
  PATTERNS,
  SERVICE_NAMES,
} from 'src/utils/constants';

import { PrismaService } from 'src/global/prisma.service';
import { TasksService } from 'src/microservices/apiService/modules/tasks/tasks.service';
import { LogsService } from 'src/global/logs.service';

import {
  getAdditionalParams,
  getOpenMissionParams,
  getPairKey,
} from 'src/microservices/apiService/modules/strategy/strategy-library';
import { getReadableError } from 'src/utils';
import { getWeb3Info } from 'src/web3/utils';

import { positionIncreaseEventParser as positionIncreaseEventParserForGMX } from 'src/web3/platform/gmx/v2/eventParsers/position-increase.parser';
import { getGnsPositionKey } from 'src/web3/platform/gns/utils';
import { getMarketInfo, getTokenInfo } from 'src/web3/platform/gmx/v2/configs';
import {
  getCollateral,
  getPairIndex,
  getPairName,
  getPair,
} from 'src/web3/platform/gns/v10/configs';
import { getPairName as getAvntPairName } from 'src/web3/platform/avnt/v1/configs';
import { GnsService } from 'src/web3/platform/gns/gns.service';

const MAX_OPEN_MISSIONS_KEY = 'max_open_missions';

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

  private async getMissions(ids: number[]): Promise<MissionBackwardDetails[]> {
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

  private async createMany(
    inputs: MissionCreateInput[],
    missionsByBotMap: Map<number, Mission[]>,
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

  private async loadMissions() {
    const missionsByBotMap = new Map<number, Mission[]>();

    const missions = await this.prismaService.mission.findMany({
      where: {
        status: {
          notIn: [MissionStatus.Closed, MissionStatus.Ignored],
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

  private async _cloneMission(
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
              `follower contract doesn't support this collateral index: ${t.collateralIndex}`,
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
                ...getOpenMissionParams(
                  bot.strategy,
                  {
                    leverage: t.leverage,
                    collateralAmount: BigInt(t.collateralAmount),
                    collateralPriceUsd: BigInt(collateralPriceUsd),
                    collateral,
                    isLong: t.long,
                    openPrice: currentPrice,
                    usdcPrice: 100_000_000n,
                    pairIndex: t.pairIndex,
                  },
                  bot.leaderCollateralBaseline,
                ),
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
            : getOpenMissionParams(
                bot.strategy,
                {
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
                },
                bot.leaderCollateralBaseline,
              );

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
            : getOpenMissionParams(
                bot.strategy,
                {
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
                },
                bot.leaderCollateralBaseline,
              );

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

  private async handleMissionLeaderActions(
    actions: ActionContext<BotContext>[],
    missionsByBotMap: Map<number, Mission[]>,
  ) {
    const totalMissionCount = Array.from(missionsByBotMap.values()).flat()
      .length;

    const totalMaxOpenMissions = await this.getMaxOpenMissions();

    if (totalMissionCount >= totalMaxOpenMissions) {
      return;
    }

    const openEvents = actions
      .filter((item) => item.context.bot.status === BotStatus.Live)
      // block leader action register if there is no pair ready
      .filter((item) => {
        const additionalParams = getAdditionalParams(
          item.context.bot.strategy.params,
        );

        const selectedPairKeys = additionalParams.selectedPairs.map((item) =>
          getPairKey(item.pair, item.isLong),
        );

        const missionCount =
          missionsByBotMap.get(item.context.bot.id)?.length || 0;

        if (missionCount >= additionalParams.maxOpenMissions) {
          return false;
        }

        if (item.context.bot.leaderContract.platform === Platform.GNS) {
          const event = missionEventParsers
            .find((parser) => parser.eventName === item.action.name)!
            .actionParser(item.action);
          const { t, collateralPriceUsd } = event.args;

          const pairName = getPairName(
            item.context.bot.leaderContract.chainId,
            t.pairIndex,
          );

          if (!pairName) {
            return false;
          }

          if (
            selectedPairKeys.length > 0 &&
            !selectedPairKeys.includes(getPairKey(pairName, Boolean(t.long)))
          ) {
            return false;
          }

          const collateral = getCollateral(
            item.context.bot.leaderContract.chainId,
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
              isLong: t.long,
              openPrice: BigInt(t.openPrice),
              usdcPrice: 100_000_000n,
              pairIndex: t.pairIndex,
            },
            item.context.bot.leaderCollateralBaseline,
          );

          // block leader action register if collateral is less than 25 USDC
          if (openMissionParams.collateralAmount < MIN_POSITION_SIZE) {
            return false;
          }

          return true;
        }

        if (item.context.bot.leaderContract.platform === Platform.GMX) {
          const event = positionIncreaseEventParserForGMX.actionParser(
            item.action,
          );

          if (event.args.sizeInUsd !== event.args.sizeDeltaUsd) {
            return false;
          }

          const marketInfo = getMarketInfo(
            item.context.bot.leaderContract.chainId,
            event.args.market,
          );

          if (!marketInfo) {
            return false;
          }

          const pairName =
            `${marketInfo.indexToken.baseSymbol || marketInfo.indexToken.symbol}/usd`.toLowerCase();

          if (
            selectedPairKeys.length > 0 &&
            !selectedPairKeys.includes(
              getPairKey(pairName, Boolean(event.args.isLong)),
            )
          ) {
            return false;
          }

          const pairIndex = getPairIndex(
            item.context.bot.followerContract.chainId,
            pairName,
          );

          if (pairIndex === -1) {
            return false;
          }

          const collateral = getTokenInfo(
            item.context.bot.leaderContract.chainId,
            event.args.collateralToken,
          );

          if (!collateral) {
            return false;
          }

          const sizeInUsd = Number(event.args.sizeInUsd) / 1e30;
          const collateralInUsd =
            (Number(event.args.collateralAmount) *
              Number(event.args['collateralTokenPrice.max'])) /
            1e30;

          const leverage = Math.floor((sizeInUsd / collateralInUsd) * 1e3);

          const openMissionParams = getOpenMissionParams(
            item.context.bot.strategy,
            {
              leverage,
              collateralAmount: BigInt(event.args.collateralAmount),
              collateralPriceUsd: BigInt(
                Math.floor(
                  Number(event.args['collateralTokenPrice.max']) /
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
              isLong: event.args.isLong,
              openPrice: 0n,
              usdcPrice: 100_000_000n,
              pairIndex: pairIndex,
            },
            item.context.bot.leaderCollateralBaseline,
          );

          // block leader action register if collateral is less than 25 USDC
          if (openMissionParams.collateralAmount < MIN_POSITION_SIZE) {
            return false;
          }

          return true;
        }

        if (item.context.bot.leaderContract.platform === Platform.AVNT) {
          const event = avntMissionEventParsers
            .find((parser) => parser.eventName === item.action.name)!
            .actionParser(item.action);

          const pairName = getAvntPairName(Number(event.args.t.pairIndex));

          if (!pairName) {
            return false;
          }

          if (
            selectedPairKeys.length > 0 &&
            !selectedPairKeys.includes(
              getPairKey(pairName, Boolean(event.args.t.buy)),
            )
          ) {
            return false;
          }

          const pairIndex = getPairIndex(
            item.context.bot.followerContract.chainId,
            pairName,
          );

          if (pairIndex === -1) {
            return false;
          }

          const openMissionParams = getOpenMissionParams(
            item.context.bot.strategy,
            {
              leverage: Number(event.args.t.leverage) / 1e7,
              collateralAmount: BigInt(event.args.positionSizeUSDC),
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
              isLong: event.args.t.buy,
              openPrice: 0n,
              usdcPrice: 100_000_000n,
              pairIndex: Number(event.args.t.pairIndex),
            },
            item.context.bot.leaderCollateralBaseline,
          );

          // block leader action register if collateral is less than 25 USDC
          if (openMissionParams.collateralAmount < MIN_POSITION_SIZE) {
            return false;
          }

          return true;
        }

        return false;
      });

    const availableMissions = totalMaxOpenMissions - totalMissionCount;

    const availableOpenEvents = openEvents.slice(0, availableMissions);

    if (availableOpenEvents.length > 0) {
      await this.createMany(
        availableOpenEvents.map((item) => {
          const additionalParams = getAdditionalParams(
            item.context.bot.strategy.params,
          );

          return {
            botId: item.context.bot.id,
            targetPositionKey: item.action.positionKey,
            targetPositionBlockNumber: item.action.blockNumber,
            targetPositionLogIndex: item.action.orderInBlock,
            mode:
              additionalParams.mode === 'signal'
                ? MissionMode.Signal
                : MissionMode.Default,
          };
        }),
        missionsByBotMap,
      );
    }
  }

  private getLeaderMissionActions(
    missionsByBotMap: Map<number, Mission[]>,
    actions: ActionContext<BotContext>[],
  ): ActionContext<MissionContext>[] {
    return actions
      .map((actionItem) => {
        const missions = missionsByBotMap.get(actionItem.context.bot.id) || [];

        const actionPositionKey = actionItem.action.positionKey;

        const sameLeaderPositionMissions = missions.filter(
          (missionItem) => missionItem.targetPositionKey === actionPositionKey,
        );

        const sortedKeys = sameLeaderPositionMissions
          .map((mission) => ({
            blockNumber: mission.targetPositionBlockNumber,
            logIndex: mission.targetPositionLogIndex,
          }))
          .sort((a, b) => {
            if (a.blockNumber !== b.blockNumber) {
              return b.blockNumber - a.blockNumber;
            }

            return b.logIndex - a.logIndex;
          });

        const key = sortedKeys.find((item) => {
          if (item.blockNumber === actionItem.action.blockNumber) {
            return item.logIndex <= actionItem.action.orderInBlock;
          } else {
            return item.blockNumber < actionItem.action.blockNumber;
          }
        });

        if (!key) {
          return [];
        }

        return sameLeaderPositionMissions
          .filter(
            (mission) =>
              mission.targetPositionBlockNumber === key.blockNumber &&
              mission.targetPositionLogIndex === key.logIndex,
          )
          .map((mission) => ({
            ...actionItem,
            context: {
              ...actionItem.context,
              mission,
            },
          }));
      })
      .flat();
  }

  // let's imagine that follower platform is only gns right now.
  private getFollowerMissionActions(
    missionsByBotMap: Map<number, Mission[]>,
    actions: ActionContext<BotContext>[],
  ): ActionContext<MissionContext>[] {
    return actions
      .map((actionItem) => {
        const missions = missionsByBotMap.get(actionItem.context.bot.id) || [];

        let actionPositionKey = actionItem.action.positionKey;

        if (
          getWeb3Info(
            actionItem.context.bot.followerContract.platform,
            actionItem.context.bot.followerContract.version,
          ).isOpenMissionAction(actionItem.action)
        ) {
          const orderId = getOrderIdFromMissionAction(actionItem.action);

          if (!orderId) {
            return [];
          }

          actionPositionKey = getGnsPositionKey(
            orderId.user.toLowerCase(),
            orderId.index,
          );
        }

        const filteredMissions = missions.filter(
          (missionItem) => missionItem.achievePositionKey === actionPositionKey,
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
    missionsByBotMap: Map<number, Mission[]>,
    followerActions: ActionContext<BotContext>[],
  ) {
    const missionActions = this.getFollowerMissionActions(
      missionsByBotMap,
      followerActions,
    );

    // handle open mission follower actions
    await this.attachAchievePositionMany(
      missionActions
        .filter((item) =>
          getWeb3Info(
            item.context.bot.followerContract.platform,
            item.context.bot.followerContract.version,
          ).isOpenMissionAction(item.action),
        )
        .map((item) => ({
          id: item.context.mission.id,
          achievePositionKey: item.action.positionKey,
          achievePositionBlockNumber: item.action.blockNumber,
          achievePositionLogIndex: item.action.orderInBlock,
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
    missionsByBotMap: Map<number, Mission[]>,
    leaderActions: ActionContext<BotContext>[],
  ) {
    await this.handleMissionLeaderActions(
      leaderActions.filter((item) =>
        getWeb3Info(
          item.context.bot.leaderContract.platform,
          item.context.bot.leaderContract.version,
        ).isOpenMissionAction(item.action),
      ),
      missionsByBotMap,
    );

    const missionActions = this.getLeaderMissionActions(
      missionsByBotMap,
      leaderActions,
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
