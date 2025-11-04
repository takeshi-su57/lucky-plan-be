import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

import { SnapshotController } from './snapshot.controller';

import { GlobalModule } from '../../global/global.module';
import { ContractsModule } from '../apiService/modules/contracts/contracts.module';
import { TradeHistoriesModule } from '../apiService/modules/trade-histories/trade-histories.module';

import { PlansModule } from '../apiService/modules/plans/plans.module';
import { GnsModule } from 'src/web3/platform/gns/gns.module';
import { Web3Module } from 'src/web3/web3/web3.module';
import { AvntModule } from 'src/web3/platform/avnt/avnt.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    GlobalModule,
    ContractsModule,
    TradeHistoriesModule,
    PlansModule,
    Web3Module,
    GnsModule,
    AvntModule,
  ],
  controllers: [SnapshotController],
})
export class SnapshotModule {}
