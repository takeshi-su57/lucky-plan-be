import { Module } from '@nestjs/common';
import { FollowerService } from './follower.service';
import { FollowerResolver } from './follower.resolver';
import { UsersModule } from 'src/users/users.module';
import { ContractsModule } from 'src/contracts/contracts.module';
import { TradeHistoriesModule } from 'src/trade-histories/trade-histories.module';

@Module({
  imports: [UsersModule, ContractsModule, TradeHistoriesModule],
  providers: [FollowerResolver, FollowerService],
  exports: [FollowerService],
})
export class FollowerModule {}
