import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from 'generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

import 'dotenv/config';

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
    const adapter = new PrismaPg({
      connectionString: process.env.DATABASE_URL,
    });
    super({ adapter });

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
