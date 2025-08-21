import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';

import { join } from 'path';

import { ApiService } from './api.service';

import { GlobalModule } from '../../global/global.module';
import { WalletAccountsModule } from './modules/wallet-accounts/wallet-accounts.module';
import { FollowerModule } from './modules/follower/follower.module';
import { StrategyModule } from './modules/strategy/strategy.module';
import { ContractsModule } from './modules/contracts/contracts.module';
import { BotsModule } from './modules/bots/bots.module';
import { PositionsModule } from './modules/positions/positions.module';
import { MissionsModule } from './modules/missions/missions.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { ActionsModule } from './modules/actions/actions.module';
import { FollowerActionsModule } from './modules/follower-actions/follower-actions.module';
import { TradeHistoriesModule } from './modules/trade-histories/trade-histories.module';
import { TaskExecutorModule } from './modules/task-executor/task-executor.module';
import { PlansModule } from './modules/plans/plans.module';
import { AuthModule } from './modules/auth/auth.module';
import { LogsModule } from './modules/loggers/logs.module';
import { SecurityModule } from './modules/security/security.module';
import { GnsModule } from 'src/web3/platform/gns/gns.module';

import { ApiResolver } from './api.resolver';
import { ApiController } from './api.controller';

@Module({
  imports: [
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: join(process.cwd(), 'src/schema.gql'),
      subscriptions: {
        'graphql-ws': true,
      },
      sortSchema: true,
    }),
    GlobalModule,
    ScheduleModule.forRoot(),
    WalletAccountsModule,
    AuthModule,
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
    SecurityModule,
    GnsModule,
  ],
  controllers: [ApiController],
  providers: [ApiService, ApiResolver],
})
export class ApiModule {}
