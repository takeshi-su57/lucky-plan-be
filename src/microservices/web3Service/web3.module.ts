import { Module, Global } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { CacheModule } from '@nestjs/cache-manager';

import { GlobalModule } from '../../global/global.module';
import { ContractsModule } from '../apiService/modules/contracts/contracts.module';

import { ChainsService } from './chains.service';
import { Web3Controller } from './web3.controller';
import { Web3Service } from './web3.service';

import { GnsV10Module } from './platform/gns/v10/gnsV10.module';

@Global()
@Module({
  providers: [ChainsService],
  exports: [ChainsService],
})
export class Web3ServiceGlobalModule {}

@Module({
  imports: [
    CacheModule.register(),
    ScheduleModule.forRoot(),
    GlobalModule,
    Web3ServiceGlobalModule,
    ContractsModule,
    GnsV10Module,
  ],
  controllers: [Web3Controller],
  providers: [Web3Service],
})
export class Web3Module {}
