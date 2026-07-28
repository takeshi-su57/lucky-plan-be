import { NestFactory } from '@nestjs/core';

import { GmxV1Module } from 'src/web3/platform/gmx/v1/gmx-v1.module';
import { GmxV1ConfigService } from 'src/web3/platform/gmx/v1/gmx-v1-config.service';

async function main() {
  const app = await NestFactory.createApplicationContext(GmxV1Module);

  try {
    await app.get(GmxV1ConfigService).generateTokenSnapshot();
  } finally {
    await app.close();
  }
}

main();
