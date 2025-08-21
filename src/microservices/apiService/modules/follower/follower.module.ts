import { Module } from '@nestjs/common';
import { FollowerService } from './follower.service';
import { FollowerResolver } from './follower.resolver';
import { WalletAccountsModule } from 'src/microservices/apiService/modules/wallet-accounts/wallet-accounts.module';
import { ContractsModule } from 'src/microservices/apiService/modules/contracts/contracts.module';
import { TradeHistoriesModule } from 'src/microservices/apiService/modules/trade-histories/trade-histories.module';
import { GnsModule } from 'src/web3/platform/gns/gns.module';
import { Web3Module } from 'src/web3/web3/web3.module';

@Module({
  imports: [
    WalletAccountsModule,
    ContractsModule,
    TradeHistoriesModule,
    Web3Module,
    GnsModule,
  ],
  providers: [FollowerResolver, FollowerService],
  exports: [FollowerService],
})
export class FollowerModule {}
