import { Module } from '@nestjs/common';

import { BotsModule } from 'src/bots/bots.module';

import { ContractsService } from './contracts.service';
import { ContractsResolver } from './contracts.resolver';
import { ContractMonitorService } from './contract-monitor.service';

@Module({
  imports: [BotsModule],
  providers: [ContractsResolver, ContractsService, ContractMonitorService],
  exports: [ContractsService, ContractMonitorService],
})
export class ContractsModule {}
