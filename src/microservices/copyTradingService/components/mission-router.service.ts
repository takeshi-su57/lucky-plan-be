import { Injectable } from '@nestjs/common';
import { BotStatus, MissionStatus, Platform } from 'generated/prisma/client';

import { ActionContext, BotContext } from 'src/types';
import {
  MissionsService,
  parseSelectedPairs,
} from 'src/microservices/apiService/modules/missions/missions.service';
import { Mission } from 'src/microservices/apiService/modules/missions/entities/mission.entity';
import { MIN_POSITION_SIZE } from 'src/utils/constants';
import {
  getOpenMissionParams,
  getPairKey,
} from 'src/microservices/apiService/modules/strategy/strategy-library';
import { getWeb3Info } from 'src/web3/utils';
import {
  getOrderIdFromMissionAction,
  missionEventParsers,
} from 'src/web3/platform/gns/v10/eventParsers';
import { missionEventParsers as avntMissionEventParsers } from 'src/web3/platform/avnt/v1/eventParsers';
import { positionIncreaseEventParser as positionIncreaseEventParserForGMX } from 'src/web3/platform/gmx/v2/eventParsers/position-increase.parser';
import { getGnsPositionKey } from 'src/web3/platform/gns/utils';
import { getMarketInfo, getTokenInfo } from 'src/web3/platform/gmx/v2/configs';
import {
  getCollateral,
  getPairIndex,
  getPairName,
} from 'src/web3/platform/gns/v10/configs';
import { getPairName as getAvntPairName } from 'src/web3/platform/avnt/v1/configs';

import { MissionRouter } from '../copy-trading.components';
import { TaskLifecycleService } from './task-lifecycle.service';

@Injectable()
export class MissionRouterService extends MissionRouter {
  constructor(
    private readonly missionsService: MissionsService,
    private readonly taskLifecycleService: TaskLifecycleService,
  ) {
    super();
  }

  private async handleMissionLeaderActions(
    actions: ActionContext<BotContext>[],
    missionsByBotMap: Map<number, Mission[]>,
  ) {
    const totalMissionCount = Array.from(missionsByBotMap.values()).flat()
      .length;

    const totalMaxOpenMissions =
      await this.missionsService.getMaxOpenMissions();
    const hasGlobalMissionLimit = totalMaxOpenMissions > 0;

    if (hasGlobalMissionLimit && totalMissionCount >= totalMaxOpenMissions) {
      return;
    }

    const openEvents = actions
      .filter((item) => item.context.bot.status !== BotStatus.Dead)
      // block leader action register if there is no pair ready
      .filter((item) => {
        const selectedPairs = parseSelectedPairs(
          item.context.bot.strategy.selectedPairs,
        );
        const selectedPairKeys = selectedPairs.map((item) =>
          getPairKey(item.pair, item.isLong),
        );

        const missionCount =
          missionsByBotMap.get(item.context.bot.id)?.length || 0;

        if (
          item.context.bot.strategy.maxOpenMissions > 0 &&
          missionCount >= item.context.bot.strategy.maxOpenMissions
        ) {
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

    const availableMissions = hasGlobalMissionLimit
      ? totalMaxOpenMissions - totalMissionCount
      : openEvents.length;
    const availableOpenEvents = hasGlobalMissionLimit
      ? openEvents.slice(0, availableMissions)
      : openEvents;

    if (availableOpenEvents.length > 0) {
      const missionIds: number[] = [];
      const updatedStrategyIds: number[] = [];

      for (const item of availableOpenEvents) {
        const { missionId, created, strategyUpdated } =
          await this.missionsService.createOpenMissionWithLifetime(item);

        if (created) {
          missionIds.push(missionId);
        }

        if (strategyUpdated) {
          updatedStrategyIds.push(item.context.bot.strategy.id);
        }
      }

      const missions = await this.missionsService.getMissions(missionIds);

      missions.forEach((mission) => {
        const arr = missionsByBotMap.get(mission.botId);

        if (arr) {
          arr.push(mission);
        } else {
          missionsByBotMap.set(mission.botId, [mission]);
        }
      });

      if (missions.length > 0) {
        await this.missionsService.emitMissionCreated(missions);
      }

      await this.missionsService.emitStrategyBotUpdates(updatedStrategyIds);
    }
  }

  async routeFollowerBotActions(actions: ActionContext<BotContext>[]) {
    const missionsByBotMap = await this.missionsService.loadMissionsByBotIds(
      actions.map((action) => action.context.bot.id),
    );

    const missionActions = actions
      .map((actionItem) => {
        const missions = missionsByBotMap.get(actionItem.context.bot.id) || [];

        let actionPositionKey = actionItem.action.positionKey;

        const isOpenAction = getWeb3Info(
          actionItem.context.bot.followerContract.platform,
          actionItem.context.bot.followerContract.version,
        ).isOpenMissionAction(actionItem.action);

        if (isOpenAction) {
          const orderId = getOrderIdFromMissionAction(actionItem.action);

          if (!orderId) {
            return [];
          }

          actionPositionKey = getGnsPositionKey(
            orderId.user.toLowerCase(),
            orderId.index,
          );
        }

        let filteredMissions = missions.filter(
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

    // handle open mission follower actions
    await this.missionsService.attachAchievePositionMany(
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

    if (missionActions.length === 0) {
      return;
    }

    await this.taskLifecycleService.handleFollowerMissionActions(
      missionActions,
      {
        closeCancelded: async (missionIds) => {
          // handle close mission follower actions
          await this.missionsService.closeMany(
            missionIds.map((item) => ({
              id: item,
            })),
            missionsByBotMap,
          );
        },
        openCanceled: async (missionIds) => {
          await this.missionsService.closeMany(
            missionIds.map((item) => ({
              id: item,
            })),
            missionsByBotMap,
          );
        },
        clone: async (missions) => {
          for (const mission of missions) {
            await this.missionsService._cloneMission(mission, missionsByBotMap);
          }
        },
      },
    );
  }

  async routeLeaderBotActions(actions: ActionContext<BotContext>[]) {
    const missionsByBotMap = await this.missionsService.loadMissionsByBotIds(
      actions.map((action) => action.context.bot.id),
    );

    await this.handleMissionLeaderActions(
      actions.filter((item) =>
        getWeb3Info(
          item.context.bot.leaderContract.platform,
          item.context.bot.leaderContract.version,
        ).isOpenMissionAction(item.action),
      ),
      missionsByBotMap,
    );

    const missionActions = actions
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

    if (missionActions.length > 0) {
      return;
    }

    await this.taskLifecycleService.handleLeaderMissionActions(
      missionActions.filter(
        (item) =>
          item.context.mission.status !== MissionStatus.Closing &&
          item.context.mission.status !== MissionStatus.Closed &&
          item.context.mission.status !== MissionStatus.Ignored,
      ),
      async (missionIds) => {
        // handle close mission follower actions
        await this.missionsService.closeMany(
          missionIds.map((item) => ({
            id: item,
          })),
          missionsByBotMap,
        );
      },
    );
  }
}
