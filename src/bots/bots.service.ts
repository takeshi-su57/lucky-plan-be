import { Injectable, Logger } from '@nestjs/common';
import { BotStatus, Contract } from '@prisma/client';
import { Address, erc20Abi, isAddressEqual, maxInt256 } from 'viem';

import { PrismaService } from 'src/global/prisma.service';
import { ChainsService } from 'src/global/chains.service';
import { MissionsService } from 'src/missions/missions.service';

import { BotUpdateInput, CreateBotInput } from './dto/bot.input';

import { ActionContext, BotContext } from 'src/types';
import { BotDetails } from './entities/bot.entity';

import { ActionDetails, ActionItem } from 'src/actions/entities/action.entity';
import { ActionsService } from 'src/actions/actions.service';
import { FollowerService } from 'src/follower/follower.service';
import { MAX_GAS, MIN_GAS, USDCCollateralIndex } from 'src/utils/constants';
import { TradingVariableService } from 'src/global/trading-variable.service';

import { getReadableError } from 'src/utils';

@Injectable()
export class BotsService {
  private bots: BotDetails[] = [];
  status: 'ready' | 'progress' = 'ready';

  constructor(
    private prismaService: PrismaService,
    private chainsService: ChainsService,
    private missionsService: MissionsService,
    private followersService: FollowerService,
    private actionsService: ActionsService,
    private tradingVariableService: TradingVariableService,
    private logger: Logger,
  ) {
    this.loadBots();
  }

  async create(input: CreateBotInput) {
    const newBot = await this.prismaService.bot.create({
      data: {
        ...input,
        leaderAddress: input.leaderAddress.toLowerCase(),
        followerAddress: input.followerAddress.toLowerCase(),
        status: BotStatus.Created,
      },
      include: {
        follower: true,
        leader: true,
        strategy: true,
        leaderContract: true,
        followerContract: true,
      },
    });

    this.bots.push(newBot);

    return newBot;
  }

  async delete(id: number) {
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
    });

    if (!deletedBot) {
      throw new Error('Cannot delete a bot');
    }

    this.bots = this.bots.filter((item) => item.id !== id);

    return id;
  }

  async reBalanceAsset(bot: BotDetails) {
    try {
      const { followerContract, follower, strategy } = bot;

      const publicClient = this.chainsService.publicClient(
        followerContract.chainId,
      );

      const collateralInfo = this.tradingVariableService.getCollateral(
        bot.followerContractId,
        USDCCollateralIndex[
          followerContract.chainId as keyof typeof USDCCollateralIndex
        ],
      );

      const usdcBalance = await publicClient.readContract({
        address: collateralInfo.collateral,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [follower.address as Address],
      });

      const { minCapacity, maxCapacity } = strategy;

      if (usdcBalance < BigInt(minCapacity * 1e6)) {
        await this.followersService.moveAsset({
          address: follower.address,
          contract: followerContract,
          amount: BigInt(maxCapacity * 1e6) - usdcBalance,
          kind: 'usdcDeposit',
        });
      } else if (usdcBalance > BigInt(2 * maxCapacity * 1e6)) {
        await this.followersService.moveAsset({
          address: follower.address,
          contract: followerContract,
          amount: usdcBalance - BigInt(maxCapacity * 1e6),
          kind: 'usdcWithdraw',
        });
      }

      const ethBalance = await publicClient.getBalance({
        address: follower.address as Address,
      });

      if (ethBalance < MIN_GAS) {
        await this.followersService.moveAsset({
          address: follower.address,
          contract: followerContract,
          amount: MAX_GAS - ethBalance,
          kind: 'ethDeposit',
        });
      }
    } catch (err) {
      this.logger.error('BotsService>reBalanceAsset> ', getReadableError(err));
    }
  }

  async checkAndUpdateAllBots() {
    this.status = 'progress';

    try {
      this.logger.log('BotsService>: Rebalancing Bots');

      const promises = this.bots.map(async (bot) => {
        if (bot.status === BotStatus.Created || bot.status === BotStatus.Dead) {
          return;
        }

        if (bot.status === BotStatus.Live && bot.startedAt) {
          const startedTimestamp = new Date(bot.startedAt).getTime();
          const currentTimestamp = Date.now();

          if (
            currentTimestamp - startedTimestamp >
            bot.strategy.lifeTime * 60 * 1000
          ) {
            await this._stop(bot);
          }
        }

        if (
          bot.status === BotStatus.Stop &&
          this.missionsService.getMissionsByBotId(bot.id).length === 0
        ) {
          await this._kill(bot);
        }

        await this.reBalanceAsset(bot);
      });

      await Promise.all(promises);
    } catch (err) {
      this.logger.error(
        `BotsService>checkAndUpdateAllBots> ${getReadableError(err)}`,
      );
    }

    this.status = 'ready';
  }

  async update(input: BotUpdateInput) {
    const updatedBot = await this.prismaService.bot.update({
      where: {
        id: input.id,
      },
      data: input,
      include: {
        follower: true,
        leader: true,
        strategy: true,
        leaderContract: true,
        followerContract: true,
      },
    });

    const index = this.bots.findIndex((bot) => bot.id === updatedBot.id);

    if (index !== -1) {
      this.bots[index] = updatedBot as BotDetails;
    } else {
      this.bots.push(updatedBot);
    }

    return updatedBot;
  }

  async findAll(): Promise<BotDetails[]> {
    return this.prismaService.bot.findMany({
      include: {
        follower: true,
        leader: true,
        strategy: true,
        leaderContract: true,
        followerContract: true,
      },
    });
  }

  find(status: BotStatus) {
    return this.prismaService.bot.findMany({
      where: { status },
      include: {
        follower: true,
        leader: true,
        strategy: true,
        leaderContract: true,
        followerContract: true,
      },
    });
  }

  async findOne(id: number) {
    const bot = await this.prismaService.bot.findUnique({
      where: { id },
      include: {
        follower: true,
        leader: true,
        strategy: true,
        leaderContract: true,
        followerContract: true,
      },
    });

    if (!bot) {
      throw new Error('Invalid bot id');
    }

    return bot as BotDetails;
  }

  /**
   * There can only be one bot in a live or completed state with one follower at a time.
   * @param id
   * @returns
   */
  async live(id: number) {
    const bot = await this.findOne(id);

    if (!bot) {
      throw new Error('Invalid bot id');
    }

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

    const { followerContract, follower } = bot;

    const publicClient = this.chainsService.publicClient(
      followerContract.chainId,
    );
    const walletClient = this.chainsService.walletClient(
      followerContract.chainId,
      follower,
    );

    const collateralInfo = this.tradingVariableService.getCollateral(
      bot.followerContractId,
      USDCCollateralIndex[
        followerContract.chainId as keyof typeof USDCCollateralIndex
      ],
    );

    const { request } = await publicClient.simulateContract({
      account: walletClient.account,
      address: collateralInfo.collateral,
      abi: erc20Abi,
      functionName: 'approve',
      args: [followerContract.address as Address, maxInt256],
    });

    await walletClient.writeContract(request);

    const leaderBlockNumber = await this.chainsService
      .publicClient(bot.leaderContract.chainId)
      .getBlockNumber();

    const followerBlockNumber = await this.chainsService
      .publicClient(bot.followerContract.chainId)
      .getBlockNumber();

    return await this.update({
      id,
      leaderStartedBlock: Number(leaderBlockNumber),
      followerStartedBlock: Number(followerBlockNumber),
      status: BotStatus.Live,
    });
  }

  private async _stop(bot: BotDetails) {
    if (bot.status !== BotStatus.Live) {
      throw new Error('Invalid bot status');
    }

    const leaderBlockNumber = await this.chainsService
      .publicClient(bot.leaderContract.chainId)
      .getBlockNumber();

    const followerBlockNumber = await this.chainsService
      .publicClient(bot.followerContract.chainId)
      .getBlockNumber();

    return await this.update({
      id: bot.id,
      leaderEndedBlock: Number(leaderBlockNumber),
      followerEndedBlock: Number(followerBlockNumber),
      status: BotStatus.Stop,
    });
  }

  async stop(id: number) {
    const bot = await this.findOne(id);

    if (!bot) {
      throw new Error('Invalid bot id');
    }

    return this._stop(bot);
  }

  private async _kill(bot: BotDetails) {
    if (BotStatus.Live !== bot.status && BotStatus.Stop !== bot.status) {
      throw new Error('Invalid bot status');
    }

    return await this.update({
      id: bot.id,
      status: BotStatus.Dead,
    });
  }

  async kill(id: number) {
    const bot = await this.findOne(id);

    if (!bot) {
      throw new Error('Invalid bot id');
    }

    return this._kill(bot);
  }

  async loadBots() {
    this.bots = await this.findAll();
  }

  filterBots(contractId: number, blockNumber: number) {
    const leaderBots: BotDetails[] = [];
    const followerBots: BotDetails[] = [];
    const totalAddresses: string[] = [];

    this.bots.forEach((bot) => {
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
    contractId: number,
    actionItems: { item: ActionItem; blockNumber: number }[],
  ) {
    const filteredActionItems: { item: ActionItem; blockNumber: number }[] = [];

    for (let i = 0; i < actionItems.length; ) {
      const { botAddressSet } = this.filterBots(
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

  private getBotContextActions(contractId: number, actions: ActionDetails[]) {
    const leaderActions: ActionContext<BotContext>[] = [];
    const followerActions: ActionContext<BotContext>[] = [];

    for (let i = 0; i < actions.length; ) {
      const { leaderBots, followerBots } = this.filterBots(
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
    const filteredActionItems = this.filterBotActions(contract.id, actionItems);

    // no need to proceed further steps
    if (filteredActionItems.length === 0) {
      return;
    }

    const actions = await this.actionsService.createMany(
      contract.id,
      filteredActionItems.map(({ item, blockNumber }, index) => ({
        name: item.name,
        positionAddress: item.position.address,
        positionIndex: item.position.index,
        args: item.args,
        blockNumber,
        orderInBlock: index,
      })),
    );

    const { leaderActions, followerActions } = this.getBotContextActions(
      contract.id,
      actions,
    );

    if (followerActions.length > 0) {
      await this.missionsService.handleFollowerActions(followerActions);
    }

    if (leaderActions.length > 0) {
      await this.missionsService.handleLeaderActions(leaderActions);
    }
  }
}
