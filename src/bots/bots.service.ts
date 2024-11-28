import { Injectable, Logger } from '@nestjs/common';
import { BotStatus, Contract } from '@prisma/client';

import { PrismaService } from 'src/global/prisma.service';
import { UsersService } from 'src/users/users.service';
import { ChainsService } from 'src/global/chains.service';
import { MissionsService } from 'src/missions/missions.service';

import { BotUpdateInput, CreateBotInput } from './dto/bot.input';

import { ActionContext, BotContext } from 'src/types';
import { BotDetails } from './entities/bot.entity';
import { ActionItem } from 'src/actions/entities/action.entity';

import { ActionsService } from 'src/actions/actions.service';
import { Address, isAddressEqual } from 'viem';

@Injectable()
export class BotsService {
  private bots: BotDetails[] = [];

  constructor(
    private prismaService: PrismaService,
    private usersService: UsersService,
    private chainsService: ChainsService,
    private missionsService: MissionsService,
    private actionsService: ActionsService,
    private logger: Logger,
  ) {
    this.loadBots();
  }

  async create(input: CreateBotInput) {
    if (!(await this.usersService.isLeaderAddress(input.leaderAddress))) {
      throw new Error(
        'Invalid Params, leaderAddress is not a leader in user table',
      );
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
        leader: true,
        strategy: true,
        leaderContract: true,
        followerContract: true,
      },
    });

    this.bots.push(newBot);

    return newBot;
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

  findAll() {
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

  async stop(id: number) {
    const bot = await this.findOne(id);

    if (!bot) {
      throw new Error('Invalid bot id');
    }

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
      id,
      leaderEndedBlock: Number(leaderBlockNumber),
      followerEndedBlock: Number(followerBlockNumber),
      status: BotStatus.Stop,
    });
  }

  // async kill(id: number) {
  // const bot = await this.findOne(id);

  // if (!bot) {
  //   throw new Error('Invalid bot id');
  // }

  // if (BotStatus.Live !== bot.status && BotStatus.SoftStop !== bot.status) {
  //   throw new Error('Invalid bot status');
  // }

  // const blockNumber = await this.chainsService
  //   .publicClient(bot.contract.chainId)
  //   .getBlockNumber();

  // return await this.update({
  //   id,
  //   endedBlock: Number(blockNumber),
  //   status: BotStatus.HardStop,
  // });
  // }

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

      let included = false;

      if (
        bot.leaderContractId === contractId &&
        bot.leaderStartedBlock &&
        bot.leaderStartedBlock < blockNumber
      ) {
        leaderBots.push(bot);
        included = true;
      }

      if (
        bot.followerContractId === contractId &&
        bot.followerStartedBlock &&
        bot.followerStartedBlock < blockNumber
      ) {
        followerBots.push(bot);
        included = true;
      }

      if (included) {
        totalAddresses.push(
          ...[
            bot.leaderAddress.toLowerCase(),
            bot.followerAddress.toLowerCase(),
          ],
        );
      }
    });

    return {
      leaderBots,
      followerBots,
      botAddressSet: new Set(totalAddresses),
    };
  }

  async handleActionItems(
    contract: Contract,
    actionItems: { item: ActionItem; blockNumber: number }[],
  ) {
    const filteredActionItems: { item: ActionItem; blockNumber: number }[] = [];

    for (let i = 0; i < actionItems.length; ) {
      const { botAddressSet } = this.filterBots(
        contract.id,
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

    // no need to proceed further steps
    if (filteredActionItems.length === 0) {
      return;
    }

    const actions = await this.actionsService.createMany(
      filteredActionItems.map(({ item, blockNumber }, index) => ({
        name: item.name,
        positionAddress: item.position.address,
        positionIndex: item.position.index,
        args: item.args,
        blockNumber,
        orderInBlock: index,
      })),
    );

    const leaderActions: ActionContext<BotContext>[] = [];
    const followerActions: ActionContext<BotContext>[] = [];

    for (let i = 0; i < actions.length; ) {
      const { leaderBots, followerBots } = this.filterBots(
        contract.id,
        actions[i].blockNumber,
      );

      let j = i;

      for (; j < actions.length; j++) {
        if (actions[i].blockNumber === actions[j].blockNumber) {
          const leaderBotActions = leaderBots.map((bot) => ({
            action: actions[j],
            context: {
              bot,
            },
          }));

          leaderActions.push(
            ...leaderBotActions.filter((action) =>
              isAddressEqual(
                action.action.position.address as Address,
                action.context.bot.leaderAddress as Address,
              ),
            ),
          );

          const followerBotActions = followerBots.map((bot) => ({
            action: actions[j],
            context: {
              bot,
            },
          }));

          followerActions.push(
            ...followerBotActions.filter((action) =>
              isAddressEqual(
                action.action.position.address as Address,
                action.context.bot.followerAddress as Address,
              ),
            ),
          );
        } else {
          break;
        }
      }

      i = j;
    }

    if (followerActions.length > 0) {
      await this.missionsService.handleFollowerActions(followerActions);
    }

    if (leaderActions.length > 0) {
      await this.missionsService.handleLeaderActions(leaderActions);
    }
  }
}
