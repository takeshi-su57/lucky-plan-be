import { Module } from '@nestjs/common';

import { Web3Module } from 'src/web3/web3/web3.module';

import { GmxV1ConfigService } from './gmx-v1-config.service';

@Module({
  imports: [Web3Module],
  providers: [GmxV1ConfigService],
  exports: [GmxV1ConfigService],
})
export class GmxV1Module {}
