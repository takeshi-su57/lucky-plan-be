import { Module } from '@nestjs/common';

import { Web3Module } from 'src/web3/web3/web3.module';

import { AvntService } from './avnt.service';

@Module({
  imports: [Web3Module],
  controllers: [],
  providers: [AvntService],
  exports: [AvntService],
})
export class AvntModule {}
