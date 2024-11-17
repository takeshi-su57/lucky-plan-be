import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';

import { join } from 'path';

import { SystemService } from './system.service';

import { GlobalModule } from './global/global.module';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { FollowerModule } from './follower/follower.module';
import { StrategyModule } from './strategy/strategy.module';
import { ContractsModule } from './contracts/contracts.module';
import { BotsModule } from './bots/bots.module';
import { PositionsModule } from './positions/positions.module';
import { MissionsModule } from './missions/missions.module';
import { TasksModule } from './tasks/tasks.module';
import { ActionsModule } from './actions/actions.module';
import { FollowerActionsModule } from './follower-actions/follower-actions.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: join(process.cwd(), 'src/schema.gql'),
      sortSchema: true,
    }),
    ScheduleModule.forRoot(),
    UsersModule,
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
  ],
  controllers: [],
  providers: [SystemService],
})
export class AppModule {}
