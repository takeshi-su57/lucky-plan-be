import { Inject, UseGuards } from '@nestjs/common';
import {
  Resolver,
  Query,
  Mutation,
  Args,
  Int,
  Subscription,
  Context,
} from '@nestjs/graphql';
import { LogSeverity, UserPermission } from 'generated/prisma/client';
import { PubSub } from 'graphql-subscriptions';

import { LogsService } from './logs.service';
import { Log, LogReviewWeek, LogsConnection, SeverityCount } from './entities/log.entity';

import { PUB_SUB } from 'src/global/global.module';
import { SUBSCRIPTION_TOKEN } from 'src/utils/constants';
import { GqlAuthGuard } from '../auth/gql-auth.guard';
import { RolesGuard } from '../auth/gql-role.guard';
import { Roles } from '../auth/roles.decorator';

@Resolver(() => Log)
@Roles(UserPermission.Admin)
@UseGuards(GqlAuthGuard, RolesGuard)
export class LogsResolver {
  constructor(
    private readonly logsService: LogsService,
    @Inject(PUB_SUB) private readonly pubSub: PubSub,
  ) {}

  @Query(() => [SeverityCount])
  getLogsSeverityCounts() {
    return this.logsService.getSeverityCounts();
  }

  @Query(() => LogsConnection)
  allLogs(
    @Args('severity', { type: () => LogSeverity, nullable: true })
    severity: LogSeverity | null,
    @Args('checked', { type: () => Boolean })
    checked: boolean,
    @Args('first', { type: () => Int }) first: number,
    @Args('after', { type: () => String, nullable: true }) after: string | null,
  ) {
    return this.logsService.allLogs(severity, checked, first, after);
  }

  @Mutation(() => Log)
  checkLog(
    @Args('id', { type: () => String }) id: string,
    @Context() context: { req: { user: { address: string } } },
  ) {
    return this.logsService.check(id, context.req.user.address);
  }

  @Query(() => [LogReviewWeek])
  logReviewWeeks() {
    return this.logsService.getReviewWeeks();
  }

  @Mutation(() => LogReviewWeek)
  reviewLogWeek(
    @Args('weekStart', { type: () => Date }) weekStart: Date,
    @Context() context: { req: { user: { address: string } } },
  ) {
    return this.logsService.reviewWeek(weekStart, context.req.user.address);
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
  subscribeToNewLog(
    @Args('severity', { type: () => LogSeverity, nullable: true })
    _severity: LogSeverity | null,
    @Args('checked', { type: () => Boolean })
    _checked: boolean,
  ) {
    return this.pubSub.asyncIterableIterator(SUBSCRIPTION_TOKEN.newLog);
  }
}
