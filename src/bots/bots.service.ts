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
  private botsByContractMap = new Map<number, BotDetails[]>();

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
      include: { follower: true, leader: true, strategy: true, contract: true },
    });

    const arr = this.botsByContractMap.get(newBot.contractId);

    if (arr) {
      arr.push(newBot as BotDetails);
    } else {
      this.botsByContractMap.set(newBot.contractId, [newBot as BotDetails]);
    }
  }

  async update(input: BotUpdateInput) {
    const updatedBot = await this.prismaService.bot.update({
      where: {
        id: input.id,
      },
      data: input,
      include: { follower: true, leader: true, strategy: true, contract: true },
    });

    const arr = this.botsByContractMap.get(updatedBot.contractId);

    if (arr) {
      const index = arr.findIndex((bot) => bot.id === updatedBot.id);

      arr[index] = updatedBot as BotDetails;
    } else {
      this.botsByContractMap.set(updatedBot.contractId, [
        updatedBot as BotDetails,
      ]);
    }

    return updatedBot;
  }

  findAll() {
    return this.prismaService.bot.findMany({
      include: { follower: true, leader: true, strategy: true, contract: true },
    });
  }

  find(status: BotStatus) {
    return this.prismaService.bot.findMany({
      where: { status },
      include: { follower: true, leader: true, strategy: true, contract: true },
    });
  }

  async findOne(id: number) {
    const bot = await this.prismaService.bot.findUnique({
      where: { id },
      include: { follower: true, leader: true, strategy: true, contract: true },
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

    const blockNumber = await this.chainsService
      .publicClient(bot.contract.chainId)
      .getBlockNumber();

    return await this.update({
      id,
      startedBlock: Number(blockNumber),
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

    const blockNumber = await this.chainsService
      .publicClient(bot.contract.chainId)
      .getBlockNumber();

    return await this.update({
      id,
      endedBlock: Number(blockNumber),
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
    const bots = await this.findAll();

    bots.forEach((bot) => {
      const arr = this.botsByContractMap.get(bot.contractId);

      if (arr) {
        arr.push(bot);
      } else {
        this.botsByContractMap.set(bot.contractId, [bot]);
      }
    });
  }

  filterBots(contractId: number, blockNumber: number) {
    const bots = this.botsByContractMap.get(contractId) || [];

    const filtered = bots.filter((bot) => {
      if (bot.status === BotStatus.Created || bot.status === BotStatus.Dead) {
        return;
      }

      // not started or started later current block number
      if (!bot.startedBlock || bot.startedBlock > blockNumber) {
        return false;
      }

      return true;
    });

    const totalAddresses: string[] = [];

    filtered.forEach((item) =>
      totalAddresses.push(
        ...[
          item.leaderAddress.toLowerCase(),
          item.followerAddress.toLowerCase(),
        ],
      ),
    );

    return {
      bots: filtered,
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
      const { bots } = this.filterBots(contract.id, actions[i].blockNumber);

      let j = i;

      for (; j < actions.length; j++) {
        if (actions[i].blockNumber === actions[j].blockNumber) {
          const botActions = bots.map((bot) => ({
            action: actions[j],
            context: {
              bot,
            },
          }));

          leaderActions.push(
            ...botActions.filter((action) =>
              isAddressEqual(
                action.action.position.address as Address,
                action.context.bot.leaderAddress as Address,
              ),
            ),
          );

          followerActions.push(
            ...botActions.filter((action) =>
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
