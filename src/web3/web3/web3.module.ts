import { Module } from '@nestjs/common';

import { ChainsService } from './chains.service';
import { EvmAdapterService } from './evm-adapter.service';

@Module({
  providers: [EvmAdapterService, ChainsService],
  exports: [EvmAdapterService, ChainsService],
})
export class Web3Module {}
