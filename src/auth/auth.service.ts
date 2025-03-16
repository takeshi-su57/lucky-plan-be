import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { getAddress, recoverMessageAddress } from 'viem';
import { generateMnemonic, english } from 'viem/accounts';

import { PrismaService } from 'src/global/prisma.service';
import { UserPermission } from '@prisma/client';
import { User } from './entities/auth.entity';

@Injectable()
export class AuthService {
  constructor(
    private jwtService: JwtService,
    private prisma: PrismaService,
  ) {}

  async verifyWeb3Auth(
    walletAddress: `0x${string}`,
    signature: `0x${string}`,
    timestamp: number,
  ): Promise<boolean> {
    try {
      const issuedAt = new Date(timestamp).toISOString();
      const expiresAt = new Date(timestamp + 1 * 3600 * 1000).toISOString();

      const message = [
        'Welcome to Lucky Plans!',
        `Issued At: ${issuedAt}`,
        `Expires At: ${expiresAt}`,
      ].join('\n\n');
      const recoveredAddress = await recoverMessageAddress({
        message: message,
        signature,
      });

      const checksumWalletAddress = getAddress(walletAddress);

      if (checksumWalletAddress === recoveredAddress) {
        return true;
      } else {
        return false;
      }
    } catch (error) {
      console.error(error);
      return false;
    }
  }

  async createAccount(walletAddress: `0x${string}`) {
    return await this.prisma.user.create({
      data: {
        address: walletAddress.toLowerCase(),
        mnemonic: generateMnemonic(english),
        permission: UserPermission.Trial,
      },
    });
  }

  async authenticateAccount(
    walletAddress: `0x${string}`,
    signature: `0x${string}`,
    timestamp: number,
  ): Promise<User | null> {
    let user: User | null = null;

    user = await this.prisma.user.findUnique({
      select: {
        address: true,
        permission: true,
      },
      where: { address: walletAddress.toLowerCase() },
    });

    const verified = await this.verifyWeb3Auth(
      walletAddress,
      signature,
      timestamp,
    );

    if (!verified) {
      throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
    }

    if (!user) {
      const result = await this.createAccount(walletAddress);

      if (!result) {
        throw new HttpException(
          'There was an error while creating the new account',
          HttpStatus.UNAUTHORIZED,
        );
      }

      user = {
        address: result.address,
        permission: result.permission,
      };
    }

    return user;
  }

  async getToken(
    walletAddress: `0x${string}`,
    signature: `0x${string}`,
    timestamp: number,
  ) {
    const user = await this.authenticateAccount(
      walletAddress,
      signature,
      timestamp,
    );

    if (!user) {
      throw new Error('Cannot authenticate User');
    }

    return {
      accessToken: this.jwtService.sign(user),
    };
  }

  async getAllUsers() {
    return await this.prisma.user.findMany({
      select: {
        address: true,
        permission: true,
      },
    });
  }

  async changePermission(address: string, permission: UserPermission) {
    return await this.prisma.user.update({
      select: {
        address: true,
        permission: true,
      },
      where: { address },
      data: {
        permission,
      },
    });
  }
}
