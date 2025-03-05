import { Resolver, Query, Mutation, Args, Int } from '@nestjs/graphql';
import { LogsService } from './logs.service';
import { Log, LogsConnection, SeverityCount } from './entities/log.entity';
import { LogSeverity } from '@prisma/client';

@Resolver(() => Log)
export class LogsResolver {
  constructor(private readonly logsService: LogsService) {}

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
    @Args('after', { type: () => Int, nullable: true }) after: number | null,
  ) {
    return this.logsService.allLogs(severity, checked, first, after);
  }

  @Mutation(() => Log)
  checkLog(@Args('id', { type: () => Int }) id: number) {
    return this.logsService.check(id);
  }
}
