import { Injectable } from '@nestjs/common';
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

@Injectable()
export class BotsService {
  private botsByContractMap = new Map<number, BotDetails[]>();

  constructor(
    private prismaService: PrismaService,
    private usersService: UsersService,
    private chainsService: ChainsService,
    private missionsService: MissionsService,
    private actionsService: ActionsService,
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
  }

  async findAll() {
    return (await this.prismaService.bot.findMany({
      include: { follower: true, leader: true, strategy: true, contract: true },
    })) as BotDetails[];
  }

  async find(status: BotStatus): Promise<BotDetails[]> {
    return (await this.prismaService.bot.findMany({
      where: { status },
      include: { follower: true, leader: true, strategy: true, contract: true },
    })) as BotDetails[];
  }

  async findOne(id: number): Promise<BotDetails> {
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
          in: [BotStatus.Live, BotStatus.Finish],
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

    return this.update({
      id,
      startedBlock: Number(blockNumber),
      status: BotStatus.Live,
    });
  }

  async finish(id: number) {
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

    return this.update({
      id,
      pausedBlock: Number(blockNumber),
      status: BotStatus.Finish,
    });
  }

  async kill(id: number) {
    const bot = await this.findOne(id);

    if (!bot) {
      throw new Error('Invalid bot id');
    }

    if (bot.status !== BotStatus.Finish) {
      throw new Error('Invalid bot status');
    }

    const blockNumber = await this.chainsService
      .publicClient(bot.contract.chainId)
      .getBlockNumber();

    return this.update({
      id,
      endedBlock: Number(blockNumber),
      status: BotStatus.Dead,
    });
  }

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
      // not started or started later current block number
      if (!bot.startedBlock || bot.startedBlock > blockNumber) {
        return false;
      }

      // stopped bot
      if (bot.endedBlock !== null && bot.endedBlock < blockNumber) {
        return false;
      }

      return true;
    });

    const totalAddresses: string[] = [];

    filtered.forEach((item) =>
      totalAddresses.push(...[item.leaderAddress, item.followerAddress]),
    );

    return {
      bots: filtered,
      botAddressSet: new Set(totalAddresses),
    };
  }

  async handleActionItems(
    contract: Contract,
    blockNumber: number,
    actionItems: ActionItem[],
  ) {
    const { bots, botAddressSet } = await this.filterBots(
      contract.id,
      blockNumber,
    );

    const filteredActionItems = actionItems.filter((item) =>
      botAddressSet.has(item.position.address),
    );

    // no need to proceed further steps
    if (bots.length === 0 || filteredActionItems.length === 0) {
      return;
    }

    const actions = await this.actionsService.createMany(
      filteredActionItems.map((item, index) => ({
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

    for (const bot of bots) {
      leaderActions.push(
        ...actions
          .filter((item) => item.position.address === bot.leaderAddress)
          .map((item) => ({
            action: item,
            context: {
              bot,
            },
          })),
      );

      followerActions.push(
        ...actions
          .filter((item) => item.position.address === bot.followerAddress)
          .map((item) => ({
            action: item,
            context: {
              bot,
            },
          })),
      );
    }

    if (followerActions.length > 0) {
      await this.missionsService.handleFollowerActions(followerActions);
    }

    if (leaderActions.length > 0) {
      await this.missionsService.handleLeaderActions(leaderActions);
    }
  }
}
