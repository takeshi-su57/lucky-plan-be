import { Module } from '@nestjs/common';

import { ContractsService } from './contracts.service';
import { ContractsResolver } from './contracts.resolver';
import { Web3Module } from 'src/web3/web3/web3.module';

@Module({
  imports: [Web3Module],
  providers: [ContractsResolver, ContractsService],
  exports: [ContractsService],
})
export class ContractsModule {}
