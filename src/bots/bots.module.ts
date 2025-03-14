import { Module } from '@nestjs/common';

import { WalletAccountsModule } from 'src/wallet-accounts/wallet-accounts.module';
import { MissionsModule } from 'src/missions/missions.module';

import { BotsService } from './bots.service';
import { BotsResolver } from './bots.resolver';

import { ActionsModule } from 'src/actions/actions.module';
import { FollowerModule } from 'src/follower/follower.module';
import { StrategyModule } from 'src/strategy/strategy.module';
import { LogsModule } from 'src/loggers/logs.module';

@Module({
  imports: [
    WalletAccountsModule,
    MissionsModule,
    ActionsModule,
    FollowerModule,
    StrategyModule,
    LogsModule,
  ],
  providers: [BotsResolver, BotsService],
  exports: [BotsService],
})
export class BotsModule {}
