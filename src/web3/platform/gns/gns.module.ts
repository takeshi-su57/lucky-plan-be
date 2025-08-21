import { Module, forwardRef } from '@nestjs/common';
import { ContractsModule } from 'src/microservices/apiService/modules/contracts/contracts.module';
import { Web3Module } from 'src/web3/web3/web3.module';

import { GnsService } from './gns.service';

@Module({
  imports: [forwardRef(() => ContractsModule), Web3Module],
  controllers: [],
  providers: [GnsService],
  exports: [GnsService],
})
export class GnsModule {}
