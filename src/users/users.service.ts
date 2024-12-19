import { Injectable } from '@nestjs/common';

import { PrismaService } from 'src/global/prisma.service';

import { ChangeUserTagInput } from './dto/user.input';

@Injectable()
export class UsersService {
  constructor(private prismaService: PrismaService) {}

  addUser(address: string) {
    return this.prismaService.user.upsert({
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
    return this.prismaService.user.upsert({
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
    return this.prismaService.user.upsert({
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
    return this.prismaService.user.update({
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

  getUserByAddress(address: string) {
    return this.prismaService.user.findUnique({
      where: {
        address: address.toLowerCase(),
      },
      include: {
        tags: true,
      },
    });
  }

  getAllUsers() {
    return this.prismaService.user.findMany({ include: { tags: true } });
  }
}
