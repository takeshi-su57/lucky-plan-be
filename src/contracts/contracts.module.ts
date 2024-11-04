import { Module } from '@nestjs/common';
import { ContractsService } from './contracts.service';
import { ContractsResolver } from './contracts.resolver';
import { ChainsService } from './chains.service';

@Module({
  providers: [ContractsResolver, ContractsService, ChainsService],
  exports: [ContractsService, ChainsService],
})
export class ContractsModule {}
