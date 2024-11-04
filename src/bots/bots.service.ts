import { Injectable } from '@nestjs/common';
import { BotStatus } from '@prisma/client';

import { PrismaService } from 'src/global/prisma.service';
import { UsersService } from 'src/users/users.service';
import { ChainsService } from 'src/contracts/chains.service';

import { CreateBotInput } from './dto/bot.input';

@Injectable()
export class BotsService {
  constructor(
    private prismaService: PrismaService,
    private usersService: UsersService,
    private chainsService: ChainsService,
  ) {}

  async create(input: CreateBotInput) {
    if (!(await this.usersService.isLeaderAddress(input.leaderAddress))) {
      throw new Error(
        'Invalid Params, leaderAddress is not a leader in user table',
      );
    }

    return this.prismaService.bot.create({
      data: {
        ...input,
        status: BotStatus.Created,
      },
    });
  }

  findAll() {
    return this.prismaService.bot.findMany();
  }

  findOne(id: number) {
    return this.prismaService.bot.findUnique({
      where: { id },
      include: { follower: true, leader: true, strategy: true, contract: true },
    });
  }

  async live(id: number) {
    const bot = await this.findOne(id);

    if (!bot) {
      throw new Error('Invalid bot id');
    }

    if (bot.status !== BotStatus.Created) {
      throw new Error('Invalid bot status');
    }

    const blockNumber = await this.chainsService
      .publicClient(bot.contract.chainId)
      .getBlockNumber();

    return this.prismaService.bot.update({
      where: {
        id,
      },
      data: {
        startedBlock: Number(blockNumber),
        status: BotStatus.Live,
      },
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

    return this.prismaService.bot.update({
      where: {
        id,
      },
      data: {
        pausedBlock: Number(blockNumber),
        status: BotStatus.Finish,
      },
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

    return this.prismaService.bot.update({
      where: {
        id,
      },
      data: {
        endedBlock: Number(blockNumber),
        status: BotStatus.Dead,
      },
    });
  }
}
