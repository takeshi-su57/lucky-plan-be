import { Injectable } from '@nestjs/common';
import { User, UserRole } from '@prisma/client';
import { Address } from 'viem';

import { PrismaService } from 'src/global/prisma.service';

@Injectable()
export class UsersService {
  constructor(private prismaService: PrismaService) {}

  async addUser(address: Address): Promise<User> {
    return this.prismaService.user.upsert({
      where: { address },
      update: {},
      create: {
        address,
        role: UserRole.User,
      },
    });
  }

  async changeRole(address: Address, role: UserRole): Promise<User> {
    return this.prismaService.user.update({
      where: {
        address,
      },
      data: {
        role,
      },
    });
  }

  async getUserByAddress(address: Address): Promise<User | null> {
    return this.prismaService.user.findUnique({
      where: {
        address,
      },
    });
  }

  async getAllLeaders() {
    return this.prismaService.user.findMany({
      where: {
        role: UserRole.Leader,
      },
    });
  }

  async isLeaderAddress(address: Address): Promise<boolean> {
    const user = await this.getUserByAddress(address);

    return !!user && user.role === UserRole.Leader;
  }
}
