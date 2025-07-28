import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { ClientsModule, Transport } from '@nestjs/microservices';

import { join } from 'path';

import { ApiService } from './api.service';
import { ContractMonitorService } from './contract-monitor.service';

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

import { ApiResolver } from './api.resolver';
import { ApiController } from './api.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: join(process.cwd(), 'src/schema.gql'),
      subscriptions: {
        'graphql-ws': true,
      },
      sortSchema: true,
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
  controllers: [ApiController],
  providers: [ApiService, ContractMonitorService, ApiResolver],
})
export class ApiModule {}
