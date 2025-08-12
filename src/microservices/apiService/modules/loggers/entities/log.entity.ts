import { ObjectType, Field, Int, registerEnumType } from '@nestjs/graphql';
import { LogSeverity } from '@prisma/client';

registerEnumType(LogSeverity, {
  name: 'LogSeverity',
});

@ObjectType()
export class Log {
  @Field(() => Int)
  id: number;

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
}

@ObjectType()
export class LogsEdge {
  @Field(() => Int) cursor: number;
  @Field(() => Log) node: Log;
}

@ObjectType()
export class LogsPageInfo {
  @Field(() => Boolean) hasNextPage: boolean;
  @Field(() => Int, { nullable: true }) endCursor: number | null;
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
