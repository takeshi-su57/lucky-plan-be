import { Injectable, Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { BotStatus, Contract, MissionStatus } from '@prisma/client';
import { Address, isAddressEqual, maxInt256 } from 'viem';

import { PrismaService } from 'src/global/prisma.service';
import { MissionsService } from 'src/microservices/apiService/modules/missions/missions.service';

import {
  BotUpdateInput,
  CreateBotAndStrategyInput,
  CreateBotInput,
} from './dto/bot.input';

import { ActionContext, BotContext, ServiceStatus } from 'src/types';
import {
  BotConnection,
  BotDetails,
  BotBackwardDetails,
  BotForwardDetails,
} from './entities/bot.entity';

import {
  ActionDetails,
  ActionItem,
} from 'src/microservices/apiService/modules/actions/entities/action.entity';
import { ActionsService } from 'src/microservices/apiService/modules/actions/actions.service';
import { FollowerService } from 'src/microservices/apiService/modules/follower/follower.service';
import {
  MAX_GAS,
  MIN_GAS,
  PATTERNS,
  SERVICE_NAMES,
  USDCCollateralIndex,
} from 'src/utils/constants';

import { getReadableError } from 'src/utils';

import { StrategyService } from 'src/microservices/apiService/modules/strategy/strategy.service';
import { LogsService } from 'src/global/logs.service';
import { Web3Service } from 'src/global/web3.service';
import { GnsV10Service } from 'src/global/gnsV10.service';

@Injectable()
export class BotsService {
  status: ServiceStatus = ServiceStatus.READY;

  constructor(
    @Inject(SERVICE_NAMES.REDIS_SERVICE) private redisClient: ClientProxy,
    private readonly prismaService: PrismaService,
    private readonly web3Service: Web3Service,
    private readonly gnsV10Service: GnsV10Service,
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

    this.redisClient.emit(PATTERNS.Bots.BotCreated, [bot]);

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
        followerAddress: masterFollower.address.toLowerCase(),
        leaderContractId: input.leaderContractId,
        followerContractId: input.followerContractId,
        leaderCollateralBaseline: input.leaderCollateralBaseline,
      });

      bots.push(bot);
    }

    this.redisClient.emit(PATTERNS.Bots.BotCreated, bots);

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

      const ethBalance = await this.web3Service.nativeBalance({
        chainId: followerContract.chainId,
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

      for (let i = 0; i < bots.length; i += BATCH_SIZE) {
        const batchBots = bots.slice(i, i + BATCH_SIZE);

        const promises = batchBots.map(async (bot) => {
          if (
            bot.status === BotStatus.Stop &&
            !bot.missions.find(
              (item) =>
                item.status !== MissionStatus.Closed &&
                item.status !== MissionStatus.Ignored,
            )
          ) {
            await this._kill(bot);
          } else if (
            bot.status === BotStatus.Live ||
            bot.status === BotStatus.Stop
          ) {
            await this.reBalanceAsset(bot);
          }
        });

        await Promise.allSettled(promises);
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

    this.redisClient.emit(PATTERNS.Bots.BotUpdated, [updatedBot]);

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

    const mnemonic = await this.followersService.getMnemonic(userId);

    const collateralInfo = this.gnsV10Service.getCollateral(
      bot.followerContractId,
      USDCCollateralIndex[
        followerContract.chainId as keyof typeof USDCCollateralIndex
      ],
    );

    const allowance = await this.web3Service.erc20Allowance({
      chainId: followerContract.chainId,
      erc20ContractAddress: collateralInfo.collateral,
      address: follower.address as Address,
      spender: followerContract.address as Address,
    });

    if (allowance < 1000000n) {
      await this.web3Service.erc20Approve({
        chainId: followerContract.chainId,
        mnemonic,
        accountIndex: follower.accountIndex,
        erc20ContractAddress: collateralInfo.collateral,
        spender: followerContract.address as Address,
        amount: maxInt256,
      });
    }

    const leaderBlockNumber = await this.web3Service.getBlockNumber(
      bot.leaderContract.chainId,
    );

    const followerBlockNumber = await this.web3Service.getBlockNumber(
      bot.followerContract.chainId,
    );

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

    const leaderBlockNumber = await this.web3Service.getBlockNumber(
      bot.leaderContract.chainId,
    );

    const followerBlockNumber = await this.web3Service.getBlockNumber(
      bot.followerContract.chainId,
    );

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
