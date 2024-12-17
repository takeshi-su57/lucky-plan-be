import { Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';

import { PrismaService } from 'src/global/prisma.service';
import { TradeHistory } from 'src/trade-histories/entities/trade-history.entity';
import { TradeHistoriesService } from 'src/trade-histories/trade-histories.service';

@Injectable()
export class UsersService {
  constructor(
    private prismaService: PrismaService,
    private tradeHistoriesService: TradeHistoriesService,
  ) {}

  addUser(address: string) {
    return this.prismaService.user.upsert({
      where: { address: address.toLowerCase() },
      update: {},
      create: {
        address: address.toLowerCase(),
        role: UserRole.User,
      },
    });
  }

  upsertMany(addresses: string[]) {
    return this.prismaService.$transaction(
      addresses.map((address) =>
        this.prismaService.user.upsert({
          where: { address: address.toLowerCase() },
          update: {},
          create: {
            address: address.toLowerCase(),
            role: UserRole.User,
          },
        }),
      ),
    );
  }

  changeRole(address: string, role: UserRole) {
    return this.prismaService.user.update({
      where: {
        address: address.toLowerCase(),
      },
      data: {
        role,
      },
    });
  }

  getUserByAddress(address: string) {
    return this.prismaService.user.findUnique({
      where: {
        address: address.toLowerCase(),
      },
    });
  }

  getAllUsers() {
    return this.prismaService.user.findMany();
  }

  async getAllLeaders(contractId: number) {
    const leaders = await this.prismaService.user.findMany({
      where: {
        role: UserRole.Leader,
      },
    });

    const histories = await this.tradeHistoriesService.getTradeHistories(
      leaders.map((item) => item.address.toLowerCase()),
      contractId,
    );

    console.log('histories ==>', histories.length);

    const historiesMap = new Map<string, TradeHistory[]>();

    histories.forEach((history) => {
      const arr = historiesMap.get(history.address);

      if (arr) {
        arr.push(history);
      } else {
        historiesMap.set(history.address, [history]);
      }
    });

    return leaders.map((item) => ({
      ...item,
      histories: historiesMap.get(item.address) || [],
    }));
  }

  async isLeaderAddress(address: string): Promise<boolean> {
    const user = await this.getUserByAddress(address);

    return !!user && user.role === UserRole.Leader;
  }
}
