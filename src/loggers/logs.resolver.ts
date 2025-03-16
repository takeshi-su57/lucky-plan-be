import { Inject, UseGuards } from '@nestjs/common';
import {
  Resolver,
  Query,
  Mutation,
  Args,
  Int,
  Subscription,
} from '@nestjs/graphql';
import { LogSeverity, UserPermission } from '@prisma/client';
import { PubSub } from 'graphql-subscriptions';

import { LogsService } from './logs.service';
import { Log, LogsConnection, SeverityCount } from './entities/log.entity';

import { PUB_SUB } from 'src/global/global.module';
import { SUBSCRIPTION_TOKEN } from 'src/utils/constants';
import { GqlAuthGuard } from 'src/auth/gql-auth.guard';
import { RolesGuard } from 'src/auth/gql-role.guard';
import { Roles } from 'src/auth/roles.decorator';

@Resolver(() => Log)
export class LogsResolver {
  constructor(
    private readonly logsService: LogsService,
    @Inject(PUB_SUB) private readonly pubSub: PubSub,
  ) {}

  @Query(() => [SeverityCount])
  @Roles(UserPermission.Admin)
  @UseGuards(GqlAuthGuard, RolesGuard)
  getLogsSeverityCounts() {
    return this.logsService.getSeverityCounts();
  }

  @Query(() => LogsConnection)
  @Roles(UserPermission.Admin)
  @UseGuards(GqlAuthGuard, RolesGuard)
  allLogs(
    @Args('severity', { type: () => LogSeverity, nullable: true })
    severity: LogSeverity | null,
    @Args('checked', { type: () => Boolean })
    checked: boolean,
    @Args('first', { type: () => Int }) first: number,
    @Args('after', { type: () => Int, nullable: true }) after: number | null,
  ) {
    return this.logsService.allLogs(severity, checked, first, after);
  }

  @Mutation(() => Log)
  @Roles(UserPermission.Admin)
  @UseGuards(GqlAuthGuard, RolesGuard)
  checkLog(@Args('id', { type: () => Int }) id: number) {
    return this.logsService.check(id);
  }

  @Subscription(() => Log, {
    name: SUBSCRIPTION_TOKEN.newLog,
    filter: (payload, variables) => {
      if (variables.checked !== payload.newLog.checked) {
        return false;
      }

      if (variables.severity) {
        return payload.newLog.severity === variables.severity;
      }

      return true;
    },
  })
  @Roles(UserPermission.Admin)
  @UseGuards(GqlAuthGuard, RolesGuard)
  subscribeToNewLog(
    @Args('severity', { type: () => LogSeverity, nullable: true })
    _severity: LogSeverity | null,
    @Args('checked', { type: () => Boolean })
    _checked: boolean,
  ) {
    return this.pubSub.asyncIterableIterator(SUBSCRIPTION_TOKEN.newLog);
  }
}
