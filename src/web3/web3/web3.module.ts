import { Module } from '@nestjs/common';

import { EvmChainsService } from './evm-chains.service';
import { EvmAdapterService } from './evm-adapter.service';

@Module({
  providers: [EvmAdapterService, EvmChainsService],
  exports: [EvmAdapterService, EvmChainsService],
})
export class Web3Module {}
