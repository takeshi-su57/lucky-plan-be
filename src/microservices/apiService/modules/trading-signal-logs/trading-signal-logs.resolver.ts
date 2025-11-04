import {
  Resolver,
  Query,
  Mutation,
  Args,
  Int,
  Subscription,
} from '@nestjs/graphql';
import { Inject, UseGuards } from '@nestjs/common';
import { Platform, User, UserPermission } from '@prisma/client';

import { TradingSignalLogsService } from './trading-signal-logs.service';
import { TradingSignalLog } from './entities/trading-signal-logs.entity';

import { GqlAuthGuard } from 'src/microservices/apiService/modules/auth/gql-auth.guard';
import { CurrentUser } from 'src/microservices/apiService/modules/auth/user.decorator';
import { RolesGuard } from 'src/microservices/apiService/modules/auth/gql-role.guard';
import { Roles } from 'src/microservices/apiService/modules/auth/roles.decorator';
import { SUBSCRIPTION_TOKEN } from 'src/utils/constants';
import { PUB_SUB } from 'src/global/global.module';
import { PubSub } from 'graphql-subscriptions';

@Resolver()
export class TradingSignalLogsResolver {
  constructor(
    private readonly tradingSignalLogsService: TradingSignalLogsService,
    @Inject(PUB_SUB) private readonly pubSub: PubSub,
  ) {}

  @Query(() => [TradingSignalLog])
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  getTradingSignalLogs(@CurrentUser() _user: User) {
    return this.tradingSignalLogsService.getAll();
  }

  @Mutation(() => TradingSignalLog)
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  registerTradingSignalLog(
    @Args('platform', { type: () => Platform }) platform: Platform,
    @Args('address', { type: () => String }) address: string,
    @CurrentUser() _user: User,
  ) {
    return this.tradingSignalLogsService.register(platform, address);
  }

  @Mutation(() => TradingSignalLog)
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  unregisterTradingSignalLog(
    @Args('signalId', { type: () => Int }) signalId: number,
    @CurrentUser() _user: User,
  ) {
    return this.tradingSignalLogsService.unregister(signalId);
  }

  @Mutation(() => TradingSignalLog)
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  removeEventLogsFromTradingSignalLog(
    @Args('signalId', { type: () => Int }) signalId: number,
    @Args('eventLogIds', { type: () => [Int] }) eventLogIds: number[],
    @CurrentUser() _user: User,
  ) {
    return this.tradingSignalLogsService.removeEventLogs(signalId, eventLogIds);
  }

  @Subscription(() => [TradingSignalLog], {
    name: SUBSCRIPTION_TOKEN.tradingSignalLogUpdated,
  })
  subscribeToTradingSignalLogUpdated() {
    return this.pubSub.asyncIterableIterator(
      SUBSCRIPTION_TOKEN.tradingSignalLogUpdated,
    );
  }
}
