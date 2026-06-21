import { Injectable } from '@nestjs/common';
import { isAddressEqual, Address } from 'viem';

import { Contract } from 'generated/prisma/client';

import { ActionsService } from 'src/microservices/apiService/modules/actions/actions.service';
import { BotsService } from 'src/microservices/apiService/modules/bots/bots.service';
import { BotBackwardDetails } from 'src/microservices/apiService/modules/bots/entities/bot.entity';
import { ContractActionItem } from '../copy-trading.types';
import { ActionRouter } from '../copy-trading.components';
import { MissionRouterService } from './mission-router.service';
import { getReadableError } from 'src/utils';

const ACTION_PROCESSOR = 'copy-trading-action-router';

@Injectable()
export class ActionRouterService extends ActionRouter {
  private bots: Record<number, BotBackwardDetails[]> = {};

  constructor(
    private readonly actionsService: ActionsService,
    private readonly botsService: BotsService,
    private readonly missionRouter: MissionRouterService,
  ) {
    super();
  }

  async loadContext(): Promise<void> {
    const allBots = await this.botsService.getAllActiveBots();

    allBots.forEach((bot) => {
      const arr = this.bots[bot.leaderContractId];

      if (arr) {
        arr.push(bot);
      } else {
        this.bots[bot.leaderContractId] = [bot];
      }
    });
  }

  async routeLeaderActionItems(
    contract: Contract,
    blockNumber: number,
    actionItems: ContractActionItem[],
  ): Promise<void> {
    const filteredBots = this.bots[contract.id].filter(
      (bot) => !!bot.leaderStartedBlock && bot.leaderStartedBlock < blockNumber,
    );

    const botAddressSet = new Set(
      filteredBots.map((item) => item.leaderAddress.toLowerCase()),
    );

    const filteredActionItems = actionItems.filter((actionItem) =>
      botAddressSet.has(actionItem.item.address.toLowerCase()),
    );

    if (filteredActionItems.length === 0) {
      return;
    }

    const savedActions = await this.actionsService.createManyForContract(
      contract.id,
      filteredActionItems.map(
        ({ item, blockNumber, logIndex, blockHash, txHash }) => ({
          name: item.name,
          positionKey: item.positionKey,
          address: item.address.toLowerCase(),
          args: item.args,
          blockNumber,
          orderInBlock: logIndex,
          blockHash: blockHash || undefined,
          txHash: txHash || undefined,
        }),
      ),
    );

    const pendingActions = await this.actionsService.getUnprocessedActions(
      savedActions,
      ACTION_PROCESSOR,
    );

    if (pendingActions.length === 0) {
      return;
    }

    const actions = pendingActions
      .map((action) =>
        filteredBots
          .filter((bot) =>
            isAddressEqual(
              action.address as Address,
              bot.leaderAddress as Address,
            ),
          )
          .map((bot) => ({
            action,
            context: {
              bot,
            },
          })),
      )
      .flat();

    try {
      await this.missionRouter.routeLeaderBotActions(actions);

      await this.markRoutedActionsProcessed(
        pendingActions.map((action) => action.id),
      );
    } catch (err) {
      await this.markRoutedActionsFailed(
        pendingActions.map((action) => action.id),
        getReadableError(err),
      );

      throw err;
    }
  }

  async routeFollowerActionItems(
    contract: Contract,
    blockNumber: number,
    actionItems: ContractActionItem[],
  ): Promise<void> {
    const filteredBots = this.bots[contract.id].filter(
      (bot) =>
        !!bot.followerStartedBlock && bot.followerStartedBlock < blockNumber,
    );

    const botAddressSet = new Set(
      filteredBots.map((item) => item.followerAddress.toLowerCase()),
    );

    const filteredActionItems = actionItems.filter((actionItem) =>
      botAddressSet.has(actionItem.item.address.toLowerCase()),
    );

    if (filteredActionItems.length === 0) {
      return;
    }

    const savedActions = await this.actionsService.createManyForContract(
      contract.id,
      filteredActionItems.map(
        ({ item, blockNumber, logIndex, blockHash, txHash }) => ({
          name: item.name,
          positionKey: item.positionKey,
          address: item.address.toLowerCase(),
          args: item.args,
          blockNumber,
          orderInBlock: logIndex,
          blockHash: blockHash || undefined,
          txHash: txHash || undefined,
        }),
      ),
    );

    const pendingActions = await this.actionsService.getUnprocessedActions(
      savedActions,
      ACTION_PROCESSOR,
    );

    if (pendingActions.length === 0) {
      return;
    }

    const actions = pendingActions
      .map((action) =>
        filteredBots
          .filter((bot) =>
            isAddressEqual(
              action.address as Address,
              bot.followerAddress as Address,
            ),
          )
          .map((bot) => ({
            action,
            context: {
              bot,
            },
          })),
      )
      .flat();

    try {
      await this.missionRouter.routeFollowerBotActions(actions);

      await this.markRoutedActionsProcessed(
        pendingActions.map((action) => action.id),
      );
    } catch (err) {
      await this.markRoutedActionsFailed(
        pendingActions.map((action) => action.id),
        getReadableError(err),
      );

      throw err;
    }
  }

  async markRoutedActionsProcessed(pendingActionIds: number[]): Promise<void> {
    await this.actionsService.markActionsProcessed(
      pendingActionIds,
      ACTION_PROCESSOR,
    );
  }

  async markRoutedActionsFailed(
    pendingActionIds: number[],
    error: string,
  ): Promise<void> {
    await this.actionsService.markActionsFailed(
      pendingActionIds,
      ACTION_PROCESSOR,
      error,
    );
  }
}
