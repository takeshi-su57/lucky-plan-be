import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { ScheduleModule } from '@nestjs/schedule';

import { LeaderboardController } from './leaderboard.controller';

import { GlobalModule } from '../../global/global.module';
import { WalletAccountsModule } from '../../wallet-accounts/wallet-accounts.module';
import { AuthModule } from '../../auth/auth.module';
import { FollowerModule } from '../../follower/follower.module';
import { StrategyModule } from '../../strategy/strategy.module';
import { ContractsModule } from '../../contracts/contracts.module';
import { BotsModule } from '../../bots/bots.module';
import { PositionsModule } from '../../positions/positions.module';
import { MissionsModule } from '../../missions/missions.module';
import { TasksModule } from '../../tasks/tasks.module';
import { ActionsModule } from '../../actions/actions.module';
import { FollowerActionsModule } from '../../follower-actions/follower-actions.module';
import { TradeHistoriesModule } from '../../trade-histories/trade-histories.module';
import { TaskExecutorModule } from '../../task-executor/task-executor.module';
import { PlansModule } from '../../plans/plans.module';
import { LogsModule } from '../../loggers/logs.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ClientsModule.register([
      {
        name: 'REDIS_SERVICE',
        transport: Transport.REDIS,
        options: {
          host: process.env.REDIS_HOST || 'localhost',
          port: parseInt(process.env.REDIS_PORT || '6379'),
        },
      },
    ]),
    ScheduleModule.forRoot(),
    WalletAccountsModule,
    AuthModule,
    GlobalModule,
    FollowerModule,
    StrategyModule,
    ContractsModule,
    BotsModule,
    PositionsModule,
    MissionsModule,
    TasksModule,
    ActionsModule,
    FollowerActionsModule,
    TradeHistoriesModule,
    TaskExecutorModule,
    PlansModule,
    LogsModule,
  ],
  controllers: [LeaderboardController],
  providers: [],
})
export class Web3Module {}
