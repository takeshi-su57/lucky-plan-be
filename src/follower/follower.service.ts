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

  async getPrivateKey(address: string) {
    const mnemonicMetadata = await this.prismaService.metadata.findUnique({
      where: {
        key: this.prismaService.metadataKeys.mnemonic.key,
      },
    });

    const mnemonic = mnemonicMetadata?.value || '';

    if (!validateMnemonic(mnemonic, english)) {
      throw new Error('Wrong mnemonic, plz check seed the db metadata');
    }

    const record = await this.prismaService.follower.findUnique({
      where: { address },
    });

    if (!record) {
      throw new Error('Wrong address');
    }

    const account = mnemonicToAccount(mnemonic, {
      accountIndex: record.accountIndex,
    });

    return `0x${Array.from(account.getHdKey().privateKey!)
      .map((byte) => byte.toString(16).padStart(2, '0')) // Convert each byte to hex
      .join('')}`;
  }

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

        return await this.prismaService.follower.create({
          data: {
            address: account.address.toLowerCase(),
            publicKey: account.publicKey,
            accountIndex,
          },
        });
      }
    }
  }

  getAllFollowers() {
    return this.prismaService.follower.findMany();
  }

  getFollowerByAddress(address: string) {
    return this.prismaService.follower.findUnique({
      where: {
        address: address.toLowerCase(),
      },
    });
  }
}
