import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersResolver } from './users.resolver';
import { TradeHistoriesModule } from 'src/trade-histories/trade-histories.module';

@Module({
  imports: [TradeHistoriesModule],
  providers: [UsersResolver, UsersService],
  exports: [UsersService],
})
export class UsersModule {}
