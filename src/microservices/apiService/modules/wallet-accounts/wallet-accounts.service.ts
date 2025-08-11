import { Injectable } from '@nestjs/common';

import { PrismaService } from 'src/global/prisma.service';

import { ChangeUserTagInput } from './dto/user.input';

@Injectable()
export class WalletAccountsService {
  constructor(private prismaService: PrismaService) {}

  addWalletAccount(userId: string, address: string) {
    return this.prismaService.walletAccount.upsert({
      where: { userId_address: { userId, address: address.toLowerCase() } },
      update: {},
      create: {
        userId,
        address: address.toLowerCase(),
      },
      include: {
        tags: true,
      },
    });
  }

  addFollower(userId: string, address: string) {
    return this.prismaService.walletAccount.upsert({
      where: { userId_address: { userId, address: address.toLowerCase() } },
      update: {
        tags: {
          connectOrCreate: {
            where: {
              userId_tag: { userId, tag: 'FOLLOWER' },
            },
            create: {
              userId,
              tag: 'FOLLOWER',
              description: 'This user is a follower of app',
              color: '#6b21a8',
            },
          },
        },
      },
      create: {
        userId,
        address: address.toLowerCase(),
        tags: {
          connectOrCreate: {
            where: {
              userId_tag: { userId, tag: 'FOLLOWER' },
            },
            create: {
              userId,
              tag: 'FOLLOWER',
              description: 'This user is a follower of app',
              color: '#6b21a8',
            },
          },
        },
      },
      include: {
        tags: true,
      },
    });
  }

  addTag(userId: string, input: ChangeUserTagInput) {
    return this.prismaService.walletAccount.upsert({
      where: {
        userId_address: {
          userId,
          address: input.address.toLowerCase(),
        },
      },
      update: {
        tags: {
          connect: {
            userId_tag: { userId, tag: input.tag.toUpperCase() },
          },
        },
      },
      create: {
        userId,
        address: input.address.toLowerCase(),
        tags: {
          connect: {
            userId_tag: { userId, tag: input.tag.toUpperCase() },
          },
        },
      },
      include: {
        tags: true,
      },
    });
  }

  removeTag(userId: string, input: ChangeUserTagInput) {
    return this.prismaService.walletAccount.update({
      where: {
        userId_address: {
          userId,
          address: input.address.toLowerCase(),
        },
      },
      data: {
        tags: {
          disconnect: {
            userId_tag: { userId, tag: input.tag.toUpperCase() },
          },
        },
      },
      include: {
        tags: true,
      },
    });
  }

  getWalletAccountByAddress(userId: string, address: string) {
    return this.prismaService.walletAccount.findUnique({
      where: {
        userId_address: {
          userId,
          address: address.toLowerCase(),
        },
      },
      include: {
        tags: true,
      },
    });
  }

  getAllWalletAccounts(userId: string) {
    return this.prismaService.walletAccount.findMany({
      where: { userId },
      include: { tags: true },
    });
  }
}
