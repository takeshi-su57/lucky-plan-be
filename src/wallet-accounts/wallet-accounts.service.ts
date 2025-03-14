import { Injectable } from '@nestjs/common';

import { PrismaService } from 'src/global/prisma.service';

import { ChangeUserTagInput } from './dto/user.input';

@Injectable()
export class WalletAccountsService {
  constructor(private prismaService: PrismaService) {}

  addWalletAccount(address: string) {
    return this.prismaService.walletAccount.upsert({
      where: { address: address.toLowerCase() },
      update: {},
      create: {
        address: address.toLowerCase(),
      },
      include: {
        tags: true,
      },
    });
  }

  addFollower(address: string) {
    return this.prismaService.walletAccount.upsert({
      where: { address: address.toLowerCase() },
      update: {
        tags: {
          connectOrCreate: {
            where: {
              tag: 'FOLLOWER',
            },
            create: {
              tag: 'FOLLOWER',
              description: 'This user is a follower of app',
              color: '#6b21a8',
            },
          },
        },
      },
      create: {
        address: address.toLowerCase(),
        tags: {
          connectOrCreate: {
            where: {
              tag: 'FOLLOWER',
            },
            create: {
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

  addTag(input: ChangeUserTagInput) {
    return this.prismaService.walletAccount.upsert({
      where: {
        address: input.address.toLowerCase(),
      },
      update: {
        tags: {
          connect: {
            tag: input.tag.toUpperCase(),
          },
        },
      },
      create: {
        address: input.address.toLowerCase(),
        tags: {
          connect: {
            tag: input.tag.toUpperCase(),
          },
        },
      },
      include: {
        tags: true,
      },
    });
  }

  removeTag(input: ChangeUserTagInput) {
    return this.prismaService.walletAccount.update({
      where: {
        address: input.address.toLowerCase(),
      },
      data: {
        tags: {
          disconnect: {
            tag: input.tag.toUpperCase(),
          },
        },
      },
      include: {
        tags: true,
      },
    });
  }

  getWalletAccountByAddress(address: string) {
    return this.prismaService.walletAccount.findUnique({
      where: {
        address: address.toLowerCase(),
      },
      include: {
        tags: true,
      },
    });
  }

  getAllWalletAccounts() {
    return this.prismaService.walletAccount.findMany({
      include: { tags: true },
    });
  }
}
