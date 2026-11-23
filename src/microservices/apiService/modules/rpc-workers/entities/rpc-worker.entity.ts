import {
  Field,
  Float,
  Int,
  ObjectType,
  registerEnumType,
} from '@nestjs/graphql';
import {
  RpcEndpointProvider,
  RpcEndpointState,
  RpcEndpointTier,
} from 'generated/prisma/client';

registerEnumType(RpcEndpointProvider, { name: 'RpcEndpointProvider' });
registerEnumType(RpcEndpointTier, { name: 'RpcEndpointTier' });
registerEnumType(RpcEndpointState, { name: 'RpcEndpointState' });

export enum RpcWorkerStatus {
  /** Running a getLogs range right now. */
  Working = 'Working',
  /** Active and free to take a range. */
  Available = 'Available',
  /** Active but backing off after errors. */
  Penalized = 'Penalized',
  Paused = 'Paused',
  Disabled = 'Disabled',
  /** In the DB but not loaded: no backfill has run on its chain yet. */
  Idle = 'Idle',
  /** The analytics service did not answer, so runtime state is unknown. */
  Unknown = 'Unknown',
}

registerEnumType(RpcWorkerStatus, { name: 'RpcWorkerStatus' });

@ObjectType()
export class RpcWorker {
  @Field()
  key: string;

  @Field(() => Int, { nullable: true })
  endpointId: number | null;

  @Field(() => Int)
  chainId: number;

  @Field(() => RpcEndpointProvider)
  provider: RpcEndpointProvider;

  @Field(() => RpcEndpointTier)
  tier: RpcEndpointTier;

  @Field(() => String, { nullable: true })
  label: string | null;

  /** URL with API keys masked. The raw URL is never exposed. */
  @Field()
  maskedUrl: string;

  /** Fingerprint of the API key in the URL; groups endpoints by token. */
  @Field(() => String, { nullable: true })
  tokenId: string | null;

  /** Masked API key, e.g. "AkmD…x9Q2". */
  @Field(() => String, { nullable: true })
  tokenHint: string | null;

  @Field(() => RpcEndpointState)
  state: RpcEndpointState;

  @Field(() => String, { nullable: true })
  stateReason: string | null;

  @Field(() => RpcWorkerStatus)
  status: RpcWorkerStatus;

  @Field(() => Int, { nullable: true })
  maxBlockRange: number | null;

  /** Parallel requests allowed for this endpoint. */
  @Field(() => Int)
  concurrency: number;

  /** Requests running right now (up to `concurrency`). */
  @Field(() => Int)
  activeSlots: number;

  @Field(() => Int)
  penaltyLevel: number;

  @Field(() => Float, { nullable: true })
  penaltyUntil: number | null;

  @Field(() => Int)
  successCount: number;

  @Field(() => Int)
  failureCount: number;

  @Field(() => Float)
  blocksProcessed: number;

  @Field(() => Int, { nullable: true })
  avgLatencyMs: number | null;

  @Field(() => String, { nullable: true })
  lastErrorKind: string | null;

  @Field(() => String, { nullable: true })
  lastError: string | null;

  @Field(() => Float, { nullable: true })
  lastErrorAt: number | null;

  @Field(() => Float, { nullable: true })
  lastSuccessAt: number | null;

  @Field(() => Int, { nullable: true })
  assignmentContractId: number | null;

  @Field(() => Float, { nullable: true })
  assignmentFromBlock: number | null;

  @Field(() => Float, { nullable: true })
  assignmentToBlock: number | null;

  @Field(() => Float, { nullable: true })
  assignmentStartedAt: number | null;

  @Field(() => Float, { nullable: true })
  lastCheckedAt: number | null;

  @Field(() => Boolean, { nullable: true })
  lastCheckOk: boolean | null;

  @Field(() => Int, { nullable: true })
  lastCheckLatencyMs: number | null;

  @Field(() => String, { nullable: true })
  lastCheckErrorKind: string | null;

  @Field(() => String, { nullable: true })
  lastCheckError: string | null;
}

@ObjectType()
export class RpcEndpointCheckResult {
  @Field(() => Int)
  endpointId: number;

  @Field(() => Int)
  chainId: number;

  @Field()
  ok: boolean;

  @Field(() => Int, { nullable: true })
  latencyMs: number | null;

  @Field(() => String, { nullable: true })
  errorKind: string | null;

  @Field(() => String, { nullable: true })
  error: string | null;
}

@ObjectType()
export class AggressiveAdaptionProgress {
  @Field(() => Int)
  contractId: number;

  @Field(() => Int)
  chainId: number;

  @Field(() => Float)
  startedAt: number;

  @Field(() => Float)
  fromBlock: number;

  @Field(() => Float)
  endBlock: number;

  @Field(() => Float)
  checkpointBlock: number;

  @Field(() => Float)
  cursorBlock: number;

  @Field(() => Int)
  retryRanges: number;

  @Field(() => Int)
  inFlightRanges: number;

  @Field(() => Int)
  completedAheadRanges: number;

  @Field(() => Float)
  completedBlocks: number;

  @Field(() => Float)
  totalBlocks: number;
}

@ObjectType()
export class RpcRateGroup {
  /** `<provider>:<tier>`, e.g. DRPC:Free. */
  @Field()
  key: string;

  @Field(() => Int)
  inFlight: number;

  /** Max requests in flight at once; 0 = no cap. */
  @Field(() => Int)
  limit: number;

  /** Requests started per second; null = no rate limit. */
  @Field(() => Float, { nullable: true })
  ratePerSecond: number | null;

  /** Group-wide pause after the provider returned a rate-limit error. */
  @Field(() => Float, { nullable: true })
  cooldownUntil: number | null;

  /** Rate-limit errors seen since the analytics service started. */
  @Field(() => Int)
  rateLimitedCount: number;
}

@ObjectType()
export class RpcWorkerDashboard {
  @Field(() => [RpcWorker])
  workers: RpcWorker[];

  @Field(() => [AggressiveAdaptionProgress])
  adaptions: AggressiveAdaptionProgress[];

  /** Shared concurrency caps, e.g. dRPC free keys share one per-IP limit. */
  @Field(() => [RpcRateGroup])
  rateGroups: RpcRateGroup[];

  /** Backfill uses only Paid-tier endpoints while true. */
  @Field()
  paidOnly: boolean;

  @Field()
  analyticsOnline: boolean;

  @Field(() => Float)
  generatedAt: number;
}
