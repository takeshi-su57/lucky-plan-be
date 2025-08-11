import { Module, Global } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

import { GlobalModule } from '../../global/global.module';
import { ContractsModule } from '../apiService/modules/contracts/contracts.module';

import { ChainsService } from './chains.service';
import { Web3Controller } from './web3.controller';
import { CacheModule } from '@nestjs/cache-manager';
import { Web3Service } from './web3.service';

@Global()
@Module({
  providers: [ChainsService],
  exports: [ChainsService],
})
export class Web3ServiceGlobalModule {}

@Module({
  imports: [
    CacheModule.register(),
    GlobalModule,
    Web3ServiceGlobalModule,
    ScheduleModule.forRoot(),
    ContractsModule,
  ],
  controllers: [Web3Controller],
  providers: [Web3Service],
})
export class Web3Module {}
