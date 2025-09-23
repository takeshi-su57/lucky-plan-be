import { Module } from '@nestjs/common';

import { EvmChainsService } from './evm-chains.service';
import { EvmAdapterService } from './evm-adapter.service';
import { SolanaChainsService } from './solana-chains.service';

@Module({
  providers: [EvmAdapterService, EvmChainsService, SolanaChainsService],
  exports: [EvmAdapterService, EvmChainsService, SolanaChainsService],
})
export class Web3Module {}
