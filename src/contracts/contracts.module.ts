import { Module } from '@nestjs/common';

import { ContractsService } from './contracts.service';
import { ContractsResolver } from './contracts.resolver';

@Module({
  providers: [ContractsResolver, ContractsService],
  exports: [ContractsService],
})
export class ContractsModule {}
