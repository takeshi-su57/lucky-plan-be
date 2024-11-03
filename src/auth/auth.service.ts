import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';

import { PrismaService } from 'src/global/prisma.service';

@Injectable()
export class AuthService {
  constructor(
    private prismaService: PrismaService,
    private jwtService: JwtService,
  ) {}

  async validatePassword(password: string): Promise<boolean> {
    const data = await this.prismaService.metadata.findUnique({
      where: {
        key: this.prismaService.metadataKeys.password.key,
      },
    });

    return !!data && (await bcrypt.compare(password, data.value));
  }

  async changePassword(
    oldPassword: string,
    newPassword: string,
  ): Promise<boolean> {
    const passwordMetadata = await this.prismaService.metadata.findUnique({
      where: {
        key: this.prismaService.metadataKeys.password.key,
      },
    });

    if (passwordMetadata === null) {
      throw new Error('Wrong seeding for password metadata');
    }

    const isValid =
      passwordMetadata.value ===
        this.prismaService.metadataKeys.password.initialValue ||
      (await bcrypt.compare(oldPassword, passwordMetadata.value));

    if (!isValid) {
      return false;
    }

    await this.prismaService.metadata.upsert({
      where: {
        key: this.prismaService.metadataKeys.password.key,
      },
      update: {},
      create: {
        key: this.prismaService.metadataKeys.password.key,
        value: await bcrypt.hash(newPassword, 10),
      },
    });

    return true;
  }

  async getToken(password: string) {
    const isValid = await this.validatePassword(password);

    if (!isValid) {
      throw new Error('Invalid credentials');
    }

    return {
      accessToken: this.jwtService.sign({}),
    };
  }
}
