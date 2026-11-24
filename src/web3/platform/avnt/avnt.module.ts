import { Module } from '@nestjs/common';

import { Web3Module } from 'src/web3/web3/web3.module';

import { AvntConfigService } from './avnt-config.service';

@Module({
  imports: [Web3Module],
  controllers: [],
  providers: [AvntConfigService],
  exports: [AvntConfigService],
})
export class AvntModule {}
