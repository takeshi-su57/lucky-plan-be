import { Injectable, Inject } from '@nestjs/common';
import { BotStatus, Contract, MissionStatus } from '@prisma/client';
import { Address, erc20Abi, isAddressEqual, maxInt256 } from 'viem';
import { PubSub } from 'graphql-subscriptions';

import { PrismaService } from 'src/global/prisma.service';
import { ChainsService } from 'src/global/chains.service';
import { MissionsService } from 'src/missions/missions.service';

import {
  BotUpdateInput,
  CreateBotAndStrategyInput,
  CreateBotInput,
} from './dto/bot.input';

import { ActionContext, BotContext } from 'src/types';
import {
  BotConnection,
  BotDetails,
  BotBackwardDetails,
} from './entities/bot.entity';

import { ActionDetails, ActionItem } from 'src/actions/entities/action.entity';
import { ActionsService } from 'src/actions/actions.service';
import { FollowerService } from 'src/follower/follower.service';
import { MAX_GAS, MIN_GAS, USDCCollateralIndex } from 'src/utils/constants';
import { TradingVariableService } from 'src/global/trading-variable.service';

import { getReadableError } from 'src/utils';
import { StrategyService } from 'src/strategy/strategy.service';
import { LogsService } from 'src/loggers/logs.service';

import { SUBSCRIPTION_TOKEN } from 'src/utils/constants';
import { PUB_SUB } from 'src/global/global.module';

@Injectable()
export class BotsService {
  status: 'ready' | 'progress' = 'ready';

  constructor(
    @Inject(PUB_SUB) private readonly pubSub: PubSub,
    private prismaService: PrismaService,
    private chainsService: ChainsService,
    private missionsService: MissionsService,
    private followersService: FollowerService,
    private actionsService: ActionsService,
    private tradingVariableService: TradingVariableService,
    private strategyService: StrategyService,
    private logger: LogsService,
  ) {}

  async create(
    userId: string,
    input: CreateBotInput,
  ): Promise<BotBackwardDetails> {
    const plan = await this.prismaService.plan.findUnique({
      where: {
        id: input.planId,
      },
    });

    if (!plan) {
      throw new Error('Invalid plan id');
    }

    if (plan.userId !== userId) {
      throw new Error('Invalid plan id');
    }

    const newBot = await this.prismaService.bot.create({
      data: {
        ...input,
        leaderAddress: input.leaderAddress.toLowerCase(),
        followerAddress: input.followerAddress.toLowerCase(),
        status: BotStatus.Created,
      },
      include: {
        follower: true,
        strategy: true,
        leaderContract: true,
        followerContract: true,
        plan: true,
      },
    });

    this.pubSub.publish(SUBSCRIPTION_TOKEN.botCreated, {
      [SUBSCRIPTION_TOKEN.botCreated]: [newBot],
    });

    return newBot;
  }

  async batchCreateBots(
    userId: string,
    inputs: CreateBotAndStrategyInput[],
  ): Promise<BotBackwardDetails[]> {
    if (inputs.length === 0) {
      return [];
    }

    const bots: BotBackwardDetails[] = [];

    const followers = await this.followersService.getAvailableFollowers(
      userId,
      inputs.length,
    );

    if (followers.length !== inputs.length) {
      throw new Error('No available followers');
    }

    for (let i = 0; i < inputs.length; i++) {
      const input = inputs[i];
      const follower = followers[i];

      const strategy = await this.strategyService.create(input.strategy);

      const bot = await this.create(userId, {
        strategyId: strategy.id,
        planId: input.planId,
        leaderAddress: input.leaderAddress.toLowerCase(),
        followerAddress: follower.address.toLowerCase(),
        leaderContractId: input.leaderContractId,
        followerContractId: input.followerContractId,
        leaderCollateralBaseline: input.leaderCollateralBaseline,
      });

      bots.push(bot);
    }

    this.pubSub.publish(SUBSCRIPTION_TOKEN.botCreated, {
      [SUBSCRIPTION_TOKEN.botCreated]: bots,
    });

    return bots;
  }

  private async checkAuthorization(userId: string, id: number) {
    const bot = await this.prismaService.bot.findUnique({
      where: { id, plan: { userId } },
    });

    return !!bot;
  }

  private async _delete(id: number): Promise<BotBackwardDetails> {
    const bot = await this.prismaService.bot.findUnique({
      where: { id },
    });

    if (!bot) {
      throw new Error('Cannot find a bot, please check the id');
    }

    if (bot.status !== BotStatus.Created) {
      throw new Error('This bot is in usage, cannot delete it');
    }

    const deletedBot = await this.prismaService.bot.delete({
      where: { id },
      include: {
        follower: true,
        strategy: true,
        leaderContract: true,
        followerContract: true,
        plan: true,
      },
    });

    if (!deletedBot) {
      throw new Error('Cannot delete a bot');
    }

    return deletedBot;
  }

  async delete(userId: string, id: number): Promise<BotBackwardDetails> {
    const authorized = await this.checkAuthorization(userId, id);

    if (!authorized) {
      throw new Error('Invalid bot id');
    }

    return await this._delete(id);
  }

  private async reBalanceAsset(bot: BotBackwardDetails) {
    try {
      await this.logger.log({
        severity: 'Info',
        summary: 'BotsService>reBalanceAsset',
      });

      const {
        followerContract,
        follower,
        plan: { userId },
      } = bot;

      const publicClient = this.chainsService.publicClient(
        followerContract.chainId,
      );

      const ethBalance = await publicClient.getBalance({
        address: follower.address as Address,
      });

      if (ethBalance < MIN_GAS) {
        await this.followersService.depositAsset(userId, {
          address: follower.address,
          contract: followerContract,
          amount: MAX_GAS - ethBalance,
          kind: 'eth',
        });
      }
    } catch (err) {
      await this.logger.log({
        severity: 'Error',
        summary: 'BotsService>reBalanceAsset',
        details: getReadableError(err),
      });
    }
  }

  async checkAndUpdateAllBots() {
    this.status = 'progress';

    try {
      await this.logger.log({
        severity: 'Info',
        summary: 'BotsService>checkAndUpdateAllBots',
      });

      const bots = await this.prismaService.bot.findMany({
        where: {
          status: {
            notIn: [BotStatus.Created, BotStatus.Dead],
          },
        },
        include: {
          follower: true,
          strategy: true,
          leaderContract: true,
          followerContract: true,
          plan: true,
          missions: true,
        },
      });

      for (const bot of bots) {
        if (
          bot.status === BotStatus.Stop &&
          !bot.missions.find(
            (item) =>
              item.status !== MissionStatus.Closed &&
              item.status !== MissionStatus.Ignored,
          )
        ) {
          await this._kill(bot);
        }
      }

      const promises = bots.map(async (bot) => {
        if (bot.status === BotStatus.Live || bot.status === BotStatus.Stop) {
          await this.reBalanceAsset(bot);
        }
      });

      await Promise.allSettled(promises);
    } catch (err) {
      await this.logger.log({
        severity: 'Error',
        summary: 'BotsService>checkAndUpdateAllBots',
        details: getReadableError(err),
      });
    }

    this.status = 'ready';
  }

  private async _update(input: BotUpdateInput): Promise<BotBackwardDetails> {
    const updatedBot = await this.prismaService.bot.update({
      where: {
        id: input.id,
      },
      data: input,
      include: {
        follower: true,
        strategy: true,
        leaderContract: true,
        followerContract: true,
        plan: true,
      },
    });

    this.pubSub.publish(SUBSCRIPTION_TOKEN.botUpdated, {
      [SUBSCRIPTION_TOKEN.botUpdated]: [updatedBot],
    });

    return updatedBot;
  }

  async update(
    userId: string,
    input: BotUpdateInput,
  ): Promise<BotBackwardDetails> {
    const authorized = await this.checkAuthorization(userId, input.id);

    if (!authorized) {
      throw new Error('Invalid bot id');
    }

    return this._update(input);
  }

  async findByStatus(
    userId: string,
    status: BotStatus,
    first: number,
    after: number | null,
  ): Promise<BotConnection> {
    const records = await this.prismaService.bot.findMany({
      skip: after ? 1 : undefined,
      take: first,
      cursor: after
        ? {
            id: after,
          }
        : undefined,
      where: { status, plan: { userId } },
      orderBy: { id: 'desc' },
      include: {
        follower: true,
        strategy: true,
        leaderContract: true,
        followerContract: true,
        missions: {
          include: {
            targetPosition: true,
            achievePosition: true,
            tasks: {
              include: {
                action: true,
                followerActions: {
                  include: {
                    action: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    const edges = records.map((record) => ({
      cursor: record.id,
      node: record,
    }));

    return {
      edges,
      pageInfo: {
        hasNextPage: edges.length > 0,
        endCursor: edges.length > 0 ? edges[edges.length - 1].cursor : null,
      },
    };
  }

  private async findOne(id: number) {
    const bot = await this.prismaService.bot.findUnique({
      where: { id },
      include: {
        follower: true,
        strategy: true,
        leaderContract: true,
        followerContract: true,
        plan: true,
      },
    });

    if (!bot) {
      throw new Error('Invalid bot id');
    }

    return bot;
  }

  /**
   * There can only be one bot in a live or completed state with one follower at a time.
   * @param id
   * @returns
   */
  private async _live(bot: BotBackwardDetails): Promise<boolean> {
    if (bot.status !== BotStatus.Created) {
      throw new Error('Invalid bot status');
    }

    const liveOrFinishBots = await this.prismaService.bot.findMany({
      where: {
        status: {
          in: [BotStatus.Live, BotStatus.Stop],
        },
        followerAddress: bot.followerAddress,
      },
    });

    // There is a bot which having same follower and live or finish status
    if (liveOrFinishBots.length > 0) {
      throw new Error('Invalid bot status');
    }

    await this.reBalanceAsset(bot);

    const {
      followerContract,
      follower,
      plan: { userId },
    } = bot;

    const user = await this.prismaService.user.findUnique({
      where: { address: userId },
    });

    if (!user) {
      throw new Error('Invalid user id');
    }

    const mnemonic = user.mnemonic;

    const publicClient = this.chainsService.publicClient(
      followerContract.chainId,
    );
    const walletClient = this.chainsService.walletClient(
      mnemonic,
      followerContract.chainId,
      follower,
    );

    const collateralInfo = this.tradingVariableService.getCollateral(
      bot.followerContractId,
      USDCCollateralIndex[
        followerContract.chainId as keyof typeof USDCCollateralIndex
      ],
    );

    const allowance = await publicClient.readContract({
      account: walletClient.account,
      address: collateralInfo.collateral,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [follower.address as Address, followerContract.address as Address],
    });

    if (allowance < 1000000n) {
      const { request } = await publicClient.simulateContract({
        account: walletClient.account,
        address: collateralInfo.collateral,
        abi: erc20Abi,
        functionName: 'approve',
        args: [followerContract.address as Address, maxInt256],
      });

      await walletClient.writeContract(request);
    }

    const leaderBlockNumber = await this.chainsService
      .publicClient(bot.leaderContract.chainId)
      .getBlockNumber();

    const followerBlockNumber = await this.chainsService
      .publicClient(bot.followerContract.chainId)
      .getBlockNumber();

    await this._update({
      id: bot.id,
      leaderStartedBlock: Number(leaderBlockNumber),
      followerStartedBlock: Number(followerBlockNumber),
      startedAt: new Date(),
      status: BotStatus.Live,
    });

    return true;
  }

  async live(userId: string, id: number): Promise<boolean> {
    const authorized = await this.checkAuthorization(userId, id);

    if (!authorized) {
      throw new Error('Invalid bot id');
    }

    const bot = await this.findOne(id);

    if (!bot) {
      throw new Error('Invalid bot id');
    }

    await this._live(bot);

    return true;
  }

  private async _stop(bot: BotBackwardDetails) {
    if (bot.status !== BotStatus.Live) {
      throw new Error('Invalid bot status');
    }

    const leaderBlockNumber = await this.chainsService
      .publicClient(bot.leaderContract.chainId)
      .getBlockNumber();

    const followerBlockNumber = await this.chainsService
      .publicClient(bot.followerContract.chainId)
      .getBlockNumber();

    return await this._update({
      id: bot.id,
      leaderEndedBlock: Number(leaderBlockNumber),
      followerEndedBlock: Number(followerBlockNumber),
      endedAt: new Date(),
      status: BotStatus.Stop,
    });
  }

  async stop(userId: string, id: number): Promise<boolean> {
    const authorized = await this.checkAuthorization(userId, id);

    if (!authorized) {
      throw new Error('Invalid bot id');
    }

    const bot = await this.findOne(id);

    if (!bot) {
      throw new Error('Invalid bot id');
    }

    await this._stop(bot);

    return true;
  }

  private async _kill(bot: BotBackwardDetails) {
    if (BotStatus.Live !== bot.status && BotStatus.Stop !== bot.status) {
      throw new Error('Invalid bot status');
    }

    await this.followersService.withdrawAllUSDC(
      bot.plan.userId,
      bot.followerAddress,
      bot.followerContractId,
    );

    // await this.followersService.withdrawAllETH(
    //   bot.plan.userId,
    //   bot.followerAddress,
    //   bot.followerContractId,
    // );

    return await this._update({
      id: bot.id,
      status: BotStatus.Dead,
    });
  }

  private filterBots(
    bots: BotBackwardDetails[],
    contractId: number,
    blockNumber: number,
  ) {
    const leaderBots: BotDetails[] = [];
    const followerBots: BotDetails[] = [];
    const totalAddresses: string[] = [];

    bots.forEach((bot) => {
      if (bot.status === BotStatus.Created || bot.status === BotStatus.Dead) {
        return;
      }

      if (
        bot.leaderContractId === contractId &&
        bot.leaderStartedBlock &&
        bot.leaderStartedBlock < blockNumber
      ) {
        leaderBots.push(bot);
      }

      if (
        bot.followerContractId === contractId &&
        bot.followerStartedBlock &&
        bot.followerStartedBlock < blockNumber
      ) {
        followerBots.push(bot);
      }
    });

    totalAddresses.push(
      ...[
        ...leaderBots.map((item) => item.leaderAddress.toLowerCase()),
        ...followerBots.map((item) => item.followerAddress.toLowerCase()),
      ],
    );

    return {
      leaderBots,
      followerBots,
      botAddressSet: new Set(totalAddresses),
    };
  }

  private filterBotActions(
    bots: BotBackwardDetails[],
    contractId: number,
    actionItems: { item: ActionItem; blockNumber: number }[],
  ) {
    const filteredActionItems: { item: ActionItem; blockNumber: number }[] = [];

    for (let i = 0; i < actionItems.length; ) {
      const { botAddressSet } = this.filterBots(
        bots,
        contractId,
        actionItems[i].blockNumber,
      );

      let j = i;

      for (; j < actionItems.length; j++) {
        if (actionItems[i].blockNumber === actionItems[j].blockNumber) {
          if (
            botAddressSet.has(
              actionItems[j].item.position.address.toLowerCase(),
            )
          ) {
            filteredActionItems.push(actionItems[j]);
          }
        } else {
          break;
        }
      }

      i = j;
    }

    return filteredActionItems;
  }

  private getBotContextActions(
    bots: BotBackwardDetails[],
    contractId: number,
    actions: ActionDetails[],
  ) {
    const leaderActions: ActionContext<BotContext>[] = [];
    const followerActions: ActionContext<BotContext>[] = [];

    for (let i = 0; i < actions.length; ) {
      const { leaderBots, followerBots } = this.filterBots(
        bots,
        contractId,
        actions[i].blockNumber,
      );

      let j = i;

      for (; j < actions.length; j++) {
        if (actions[i].blockNumber === actions[j].blockNumber) {
          leaderActions.push(
            ...leaderBots
              .filter((bot) =>
                isAddressEqual(
                  actions[j].position.address as Address,
                  bot.leaderAddress as Address,
                ),
              )
              .map((bot) => ({
                action: actions[j],
                context: {
                  bot,
                },
              })),
          );

          followerActions.push(
            ...followerBots
              .filter((bot) =>
                isAddressEqual(
                  actions[j].position.address as Address,
                  bot.followerAddress as Address,
                ),
              )
              .map((bot) => ({
                action: actions[j],
                context: {
                  bot,
                },
              })),
          );
        } else {
          break;
        }
      }

      i = j;
    }

    return {
      leaderActions,
      followerActions,
    };
  }

  async handleActionItems(
    contract: Contract,
    actionItems: { item: ActionItem; blockNumber: number }[],
  ) {
    const bots = await this.prismaService.bot.findMany({
      where: {
        status: {
          notIn: [BotStatus.Created, BotStatus.Dead],
        },
      },
      include: {
        follower: true,
        strategy: true,
        leaderContract: true,
        followerContract: true,
        plan: true,
        missions: true,
      },
    });

    const filteredActionItems = this.filterBotActions(
      bots,
      contract.id,
      actionItems,
    );

    // no need to proceed further steps
    if (filteredActionItems.length === 0) {
      return;
    }

    const actions = await this.actionsService.createMany(
      contract.id,
      filteredActionItems.map(({ item, blockNumber }, index) => ({
        name: item.name,
        positionAddress: item.position.address.toLowerCase(),
        positionIndex: item.position.index,
        args: item.args,
        blockNumber,
        orderInBlock: index,
      })),
    );

    const { leaderActions, followerActions } = this.getBotContextActions(
      bots,
      contract.id,
      actions,
    );

    await this.missionsService.handleActions(followerActions, leaderActions);
  }
}
