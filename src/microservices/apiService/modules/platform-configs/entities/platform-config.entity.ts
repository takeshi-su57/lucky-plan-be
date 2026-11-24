import { Field, Float, Int, ObjectType } from '@nestjs/graphql';
import { Platform } from 'generated/prisma/client';

import 'src/microservices/apiService/modules/trade-histories/entities/event-logs.entity';

@ObjectType()
export class PlatformConfigReport {
  @Field(() => Platform)
  platform: Platform;

  @Field(() => Int)
  chainId: number;

  @Field()
  network: string;

  @Field({ description: '"check" (read-only) or "sync" (applied).' })
  mode: string;

  @Field(() => Int, { description: 'Pairs / markets listed by the source.' })
  sourceCount: number;

  @Field(() => Int, { description: 'Pairs / markets known after the run.' })
  effectiveCount: number;

  @Field(() => [String])
  missing: string[];

  @Field(() => [String])
  changed: string[];

  @Field(() => [String])
  applied: string[];

  @Field(() => String, { nullable: true })
  error: string | null;

  @Field(() => Float)
  finishedAt: number;
}

@ObjectType()
export class PlatformConfigChain {
  @Field(() => Platform)
  platform: Platform;

  @Field(() => Int)
  chainId: number;

  @Field()
  network: string;

  @Field({ description: 'Primary item kind: "pairs" or "markets".' })
  itemLabel: string;

  @Field(() => Int, { description: 'Primary items in the committed snapshot.' })
  snapshotCount: number;

  @Field(() => Int, { description: 'Primary items the parsers use now.' })
  effectiveCount: number;

  @Field({ description: 'Secondary item kind: "collaterals" or "tokens".' })
  secondaryLabel: string;

  @Field(() => Int)
  secondarySnapshotCount: number;

  @Field(() => Int)
  secondaryEffectiveCount: number;

  @Field(() => PlatformConfigReport, { nullable: true })
  lastCheck: PlatformConfigReport | null;

  @Field(() => PlatformConfigReport, { nullable: true })
  lastSync: PlatformConfigReport | null;
}

@ObjectType()
export class PlatformConfigDashboard {
  @Field(() => [PlatformConfigChain])
  chains: PlatformConfigChain[];

  @Field(() => Float)
  generatedAt: number;
}

@ObjectType()
export class PlatformConfigItem {
  @Field({ description: 'pair | collateral | market | token' })
  kind: string;

  @Field({ description: 'Pair/collateral index or address.' })
  key: string;

  @Field()
  name: string;

  @Field()
  detail: string;

  @Field({ description: 'True when the entry came from a runtime sync.' })
  synced: boolean;
}
