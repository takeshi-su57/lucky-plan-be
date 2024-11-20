import { Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';

import { PrismaService } from 'src/global/prisma.service';

@Injectable()
export class UsersService {
  constructor(private prismaService: PrismaService) {}

  addUser(address: string) {
    return this.prismaService.user.upsert({
      where: { address },
      update: {},
      create: {
        address: address.toLowerCase(),
        role: UserRole.User,
      },
    });
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

  getAllLeaders() {
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
