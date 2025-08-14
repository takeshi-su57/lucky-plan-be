import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  readonly metadataKeys: Record<
    string,
    {
      key: string;
      initialValue: string;
    }
  >;

  constructor() {
    super();

    this.metadataKeys = {
      password: {
        key: 'password',
        initialValue: 'init',
      },
    };
  }

  async onModuleInit() {
    await this.$connect();
  }
}
