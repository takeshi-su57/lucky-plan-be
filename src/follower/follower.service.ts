import { Injectable } from '@nestjs/common';
import { Follower } from '@prisma/client';
import { validateMnemonic } from '@scure/bip39';
import { PrismaService } from 'src/global/prisma.service';
import { UsersService } from 'src/users/users.service';
import { english, mnemonicToAccount } from 'viem/accounts';

@Injectable()
export class FollowerService {
  constructor(
    private prismaService: PrismaService,
    private usersService: UsersService,
  ) {}

  async generateNewFollower(): Promise<Follower> {
    const mnemonicMetadata = await this.prismaService.metadata.findUnique({
      where: {
        key: this.prismaService.metadataKeys.mnemonic.key,
      },
    });

    const mnemonic = mnemonicMetadata?.value || '';

    if (!validateMnemonic(mnemonic, english)) {
      throw new Error('Wrong mnemonic, plz check seed the db metadata');
    }

    for (let accountIndex = 1; ; accountIndex++) {
      const account = mnemonicToAccount(mnemonic, {
        accountIndex,
      });

      const followerRecord = await this.prismaService.follower.findUnique({
        where: {
          address: account.address,
        },
      });

      // find new account
      if (!followerRecord) {
        const user = await this.usersService.getUserByAddress(account.address);

        if (!user) {
          await this.usersService.addUser(account.address);
        }

        return this.prismaService.follower.create({
          data: {
            address: account.address,
            publicKey: account.publicKey,
            accountIndex,
          },
        });
      }
    }
  }

  async getAllFollowers() {
    return this.prismaService.follower.findMany();
  }

  async getFollowerByAddress(address: string) {
    return this.prismaService.follower.findUnique({
      where: {
        address,
      },
    });
  }
}
