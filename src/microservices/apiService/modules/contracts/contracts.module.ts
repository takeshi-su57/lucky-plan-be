import { Module, forwardRef } from '@nestjs/common';

import { ContractsService } from './contracts.service';
import { ContractsResolver } from './contracts.resolver';
import { Web3Module } from 'src/web3/web3/web3.module';
import { GnsModule } from 'src/web3/platform/gns/gns.module';

@Module({
  imports: [Web3Module, forwardRef(() => GnsModule)],
  providers: [ContractsResolver, ContractsService],
  exports: [ContractsService],
})
export class ContractsModule {}
