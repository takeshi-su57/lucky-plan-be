import { ObjectType, Field, ID, Int, registerEnumType } from '@nestjs/graphql';
import { LogSeverity } from 'generated/prisma/client';

registerEnumType(LogSeverity, {
  name: 'LogSeverity',
});

@ObjectType()
export class Log {
  @Field(() => ID)
  id: string;

  @Field(() => LogSeverity)
  severity: LogSeverity;

  @Field(() => Date)
  timestamp: Date;

  @Field()
  summary: string;

  @Field(() => String, { nullable: true })
  details: string | null;

  @Field(() => Boolean)
  checked: boolean;

  @Field()
  service: string;
}

@ObjectType()
export class LogsEdge {
  @Field(() => String) cursor: string;
  @Field(() => Log) node: Log;
}

@ObjectType()
export class LogsPageInfo {
  @Field(() => Boolean) hasNextPage: boolean;
  @Field(() => String, { nullable: true }) endCursor: string | null;
}

@ObjectType()
export class LogsConnection {
  @Field(() => [LogsEdge])
  edges: LogsEdge[];
  @Field(() => LogsPageInfo) pageInfo: LogsPageInfo;
}

@ObjectType()
export class SeverityCount {
  @Field(() => LogSeverity)
  severity: LogSeverity;

  @Field(() => Int)
  counts: number;
}

@ObjectType()
export class LogReviewWeek {
  @Field(() => Date) weekStart: Date;
  @Field(() => Date, { nullable: true }) reviewedAt: Date | null;
  @Field(() => String, { nullable: true }) reviewedBy: string | null;
}
