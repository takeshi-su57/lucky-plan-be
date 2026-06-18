import { Injectable, Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  BotStatus,
  Contract,
  MissionStatus,
  MissionMode,
  StrategyMode,
} from 'generated/prisma/client';
import { Address, isAddressEqual, maxInt256 } from 'viem';

import { PrismaService } from 'src/global/prisma.service';
import { MissionsService } from 'src/microservices/apiService/modules/missions/missions.service';

import {
  BotUpdateInput,
  CreateBotAndStrategyInput,
  CreateBotInput,
} from './dto/bot.input';

import {
  ActionContext,
  BotContext,
  ChainPriority,
  ServiceStatus,
} from 'src/types';
import {
  BotConnection,
  BotDetails,
  BotBackwardDetails,
  BotForwardDetails,
} from './entities/bot.entity';

import {
  Action,
  ActionItem,
} from 'src/microservices/apiService/modules/actions/entities/action.entity';
import { ActionsService } from 'src/microservices/apiService/modules/actions/actions.service';
import { FollowerService } from 'src/microservices/apiService/modules/follower/follower.service';
import {
  PATTERNS,
  SERVICE_NAMES,
  MainCollateralIndex,
} from 'src/utils/constants';

import { getReadableError } from 'src/utils';

import { StrategyService } from 'src/microservices/apiService/modules/strategy/strategy.service';
import { LogsService } from 'src/global/logs.service';
import { EvmAdapterService } from 'src/web3/web3/evm-adapter.service';
import { getCollateral } from 'src/web3/platform/gns/v10/configs';

@Injectable()
export class BotsService {
  status: ServiceStatus = ServiceStatus.READY;

  constructor(
    @Inject(SERVICE_NAMES.REDIS_SERVICE) private redisClient: ClientProxy,
    private readonly prismaService: PrismaService,
    private readonly evmAdapterService: EvmAdapterService,
    private readonly missionsService: MissionsService,
    private readonly followersService: FollowerService,
    private readonly actionsService: ActionsService,
    private readonly strategyService: StrategyService,
    private readonly logger: LogsService,
  ) {}

  private async _create(
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

    return newBot;
  }

  async create(
    userId: string,
    input: CreateBotInput,
  ): Promise<BotBackwardDetails> {
    const bot = await this._create(userId, input);

    await this.redisClient.emit(PATTERNS.Bots.BotCreated, [bot]);

    return bot;
  }

  async batchCreateBots(
    userId: string,
    inputs: CreateBotAndStrategyInput[],
  ): Promise<BotBackwardDetails[]> {
    if (inputs.length === 0) {
      return [];
    }

    const bots: BotBackwardDetails[] = [];

    const masterFollower =
      await this.followersService.getMasterFollower(userId);

    for (let i = 0; i < inputs.length; i++) {
      const input = inputs[i];

      const strategy = await this.strategyService.create(input.strategy);

      const bot = await this._create(userId, {
        strategyId: strategy.id,
        planId: input.planId,
        leaderAddress: input.leaderAddress.toLowerCase(),
        followerAddress: input.followerAddress
          ? input.followerAddress.toLowerCase()
          : masterFollower.address.toLowerCase(),
        leaderContractId: input.leaderContractId,
        followerContractId: input.followerContractId,
        leaderCollateralBaseline: input.leaderCollateralBaseline,
        mode: input.mode,
      });

      bots.push(bot);
    }

    await this.redisClient.emit(PATTERNS.Bots.BotCreated, bots);

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

  async checkAndUpdateAllBots() {
    this.status = ServiceStatus.PROCESS;

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

      const BATCH_SIZE = 20;

      const updatedBots: BotBackwardDetails[] = [];

      for (let i = 0; i < bots.length; i += BATCH_SIZE) {
        const batchBots = bots.slice(i, i + BATCH_SIZE);

        const promises = batchBots.map(async (bot) => {
          const realMissionsCount = bot.missions.filter(
            (item) => item.mode === MissionMode.Default,
          ).length;

          if (
            bot.status === BotStatus.Stop &&
            !bot.missions.find(
              (item) =>
                item.status !== MissionStatus.Closed &&
                item.status !== MissionStatus.Ignored,
            )
          ) {
            const updatedBot = await this._kill(bot);

            updatedBots.push(updatedBot);
          } else if (
            bot.status === BotStatus.Live &&
            bot.strategy.mode === StrategyMode.Default &&
            realMissionsCount >= bot.strategy.lifeTime
          ) {
            // handle for default bot mode.
            const updatedBot = await this._turnoffDefaultMode(bot);

            updatedBots.push(updatedBot);
          }
        });

        await Promise.allSettled(promises);
      }

      if (updatedBots.length > 0) {
        await this.redisClient.emit(PATTERNS.Bots.BotUpdated, updatedBots);
      }
    } catch (err) {
      await this.logger.log({
        severity: 'Error',
        summary: 'BotsService>checkAndUpdateAllBots',
        details: getReadableError(err),
      });
    }

    this.status = ServiceStatus.READY;
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

    const updatedBot = await this._update(input);

    await this.redisClient.emit(PATTERNS.Bots.BotUpdated, [updatedBot]);

    return updatedBot;
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
      where: {
        status,
        plan: { userId },
        missions: status === BotStatus.Dead ? { some: {} } : undefined,
      },
      orderBy: { id: 'desc' },
      include: {
        follower: true,
        strategy: true,
        leaderContract: true,
        followerContract: true,
        missions: {
          include: {
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

  async getActiveBots(userId: string): Promise<BotForwardDetails[]> {
    return await this.prismaService.bot.findMany({
      where: {
        status: {
          in: [BotStatus.Live, BotStatus.Stop],
        },
        plan: { userId },
      },
      orderBy: { id: 'desc' },
      include: {
        follower: true,
        strategy: true,
        leaderContract: true,
        followerContract: true,
        missions: {
          include: {
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
  private async _live(bot: BotBackwardDetails): Promise<BotBackwardDetails> {
    if (bot.status !== BotStatus.Created) {
      throw new Error('Invalid bot status');
    }

    // we allowed having multiple live bots with same follower

    // const liveOrFinishBots = await this.prismaService.bot.findMany({
    //   where: {
    //     status: {
    //       in: [BotStatus.Live, BotStatus.Stop],
    //     },
    //     followerAddress: bot.followerAddress,
    //   },
    // });

    // // There is a bot which having same follower and live or finish status
    // if (liveOrFinishBots.length > 0) {
    //   throw new Error('Invalid bot status');
    // }

    // await this.reBalanceAsset(bot);

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

    const mnemonic = await this.followersService.getMnemonic(user.mnemonic);

    const collateralInfo = getCollateral(
      bot.followerContract.chainId,
      MainCollateralIndex[
        followerContract.chainId as keyof typeof MainCollateralIndex
      ],
    );

    if (!collateralInfo) {
      throw new Error('Invalid collateral index');
    }

    const allowance = await this.evmAdapterService.erc20Allowance({
      chainId: followerContract.chainId,
      erc20ContractAddress: collateralInfo.collateral,
      address: follower.address as Address,
      spender: followerContract.address as Address,
      priority: ChainPriority.LOW,
    });

    if (allowance < 1000000n) {
      await this.evmAdapterService.erc20Approve({
        chainId: followerContract.chainId,
        mnemonic,
        accountIndex: follower.accountIndex,
        erc20ContractAddress: collateralInfo.collateral,
        spender: followerContract.address as Address,
        amount: maxInt256,
      });
    }

    const leaderBlockNumber = await this.evmAdapterService.getBlockNumber({
      chainId: bot.leaderContract.chainId,
      priority: ChainPriority.HIGH,
    });

    const followerBlockNumber = await this.evmAdapterService.getBlockNumber({
      chainId: bot.followerContract.chainId,
      priority: ChainPriority.HIGH,
    });

    return await this._update({
      id: bot.id,
      leaderStartedBlock: Number(leaderBlockNumber),
      followerStartedBlock: Number(followerBlockNumber),
      startedAt: new Date(),
      status: BotStatus.Live,
    });
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

    const updatedBot = await this._live(bot);

    await this.redisClient.emit(PATTERNS.Bots.BotUpdated, [updatedBot]);

    return true;
  }

  async batchLiveBots(bots: BotBackwardDetails[]): Promise<boolean> {
    const updatedBots: BotBackwardDetails[] = [];

    for (const bot of bots) {
      const updatedBot = await this._live(bot);

      updatedBots.push(updatedBot);
    }

    if (updatedBots.length > 0) {
      await this.redisClient.emit(PATTERNS.Bots.BotUpdated, updatedBots);
    }

    return true;
  }

  private async _stop(bot: BotBackwardDetails) {
    if (bot.status !== BotStatus.Live) {
      throw new Error('Invalid bot status');
    }

    const leaderBlockNumber = await this.evmAdapterService.getBlockNumber({
      chainId: bot.leaderContract.chainId,
      priority: ChainPriority.HIGH,
    });

    const followerBlockNumber = await this.evmAdapterService.getBlockNumber({
      chainId: bot.followerContract.chainId,
      priority: ChainPriority.HIGH,
    });

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

    const updatedBot = await this._stop(bot);

    await this.redisClient.emit(PATTERNS.Bots.BotUpdated, [updatedBot]);

    return true;
  }

  async batchStopBots(bots: BotBackwardDetails[]): Promise<boolean> {
    const updatedBots: BotBackwardDetails[] = [];

    for (const bot of bots) {
      const updatedBot = await this._stop(bot);

      updatedBots.push(updatedBot);
    }

    if (updatedBots.length > 0) {
      await this.redisClient.emit(PATTERNS.Bots.BotUpdated, updatedBots);
    }

    return true;
  }

  private async _kill(bot: BotBackwardDetails) {
    if (BotStatus.Live !== bot.status && BotStatus.Stop !== bot.status) {
      throw new Error('Invalid bot status');
    }

    return await this._update({
      id: bot.id,
      status: BotStatus.Dead,
    });
  }

  private async _turnoffDefaultMode(bot: BotBackwardDetails) {
    await this.prismaService.strategy.update({
      where: {
        id: bot.strategyId,
      },
      data: {
        mode: StrategyMode.Signal,
      },
    });

    return await this._update({
      id: bot.id,
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
    actionItems: { item: ActionItem; blockNumber: number; logIndex: number }[],
  ) {
    const filteredActionItems: {
      item: ActionItem;
      blockNumber: number;
      logIndex: number;
    }[] = [];

    for (let i = 0; i < actionItems.length; ) {
      const { botAddressSet } = this.filterBots(
        bots,
        contractId,
        actionItems[i].blockNumber,
      );

      let j = i;

      for (; j < actionItems.length; j++) {
        if (actionItems[i].blockNumber === actionItems[j].blockNumber) {
          if (botAddressSet.has(actionItems[j].item.address.toLowerCase())) {
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
    actions: Action[],
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
                  actions[j].address as Address,
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
                  actions[j].address as Address,
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
    actionItems: { item: ActionItem; blockNumber: number; logIndex: number }[],
  ) {
    const bots = await this.prismaService.bot.findMany({
      where: {
        status: {
          notIn: [BotStatus.Created, BotStatus.Dead],
        },
        OR: [
          { followerContractId: contract.id },
          { leaderContractId: contract.id },
        ],
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
      filteredActionItems.map(({ item, blockNumber, logIndex }) => ({
        name: item.name,
        positionKey: item.positionKey,
        address: item.address.toLowerCase(),
        args: item.args,
        blockNumber,
        orderInBlock: logIndex,
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
