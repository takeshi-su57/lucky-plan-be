import { Injectable } from '@nestjs/common';
import { User, UserRole } from '@prisma/client';

import { PrismaService } from 'src/global/prisma.service';

@Injectable()
export class UsersService {
  constructor(private prismaService: PrismaService) {}

  async addUser(address: string): Promise<User> {
    return this.prismaService.user.upsert({
      where: { address },
      update: {},
      create: {
        address,
        role: UserRole.User,
      },
    });
  }

  async changeRole(address: string, role: UserRole): Promise<User> {
    return this.prismaService.user.update({
      where: {
        address,
      },
      data: {
        role,
      },
    });
  }

  async getUserByAddress(address: string): Promise<User | null> {
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

  async isLeaderAddress(address: string): Promise<boolean> {
    const user = await this.getUserByAddress(address);

    return !!user && user.role === UserRole.Leader;
  }
}
