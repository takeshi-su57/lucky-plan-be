import { Field, InputType, Int } from '@nestjs/graphql';
import { RpcEndpointProvider, RpcEndpointTier } from 'generated/prisma/client';

@InputType()
export class CreateRpcEndpointsInput {
  @Field(() => RpcEndpointProvider)
  provider: RpcEndpointProvider;

  @Field(() => RpcEndpointTier, { defaultValue: RpcEndpointTier.Free })
  tier: RpcEndpointTier;

  /** One endpoint is created per chain. */
  @Field(() => [Int])
  chainIds: number[];

  /** API key, required for DRPC and ALCHEMY. The URL is built server-side. */
  @Field(() => String, { nullable: true })
  token?: string | null;

  /** Full URL, required for PUBLIC and CUSTOM. */
  @Field(() => String, { nullable: true })
  url?: string | null;

  @Field(() => String, { nullable: true })
  label?: string | null;

  /** Leave empty to use the provider's known free-plan limit or learn it. */
  @Field(() => Int, { nullable: true })
  maxBlockRange?: number | null;

  /** Call eth_chainId on each URL before saving. */
  @Field(() => Boolean, { defaultValue: true })
  verify: boolean;
}

@InputType()
export class UpdateRpcEndpointInput {
  @Field(() => Int)
  id: number;

  @Field(() => String, { nullable: true })
  label?: string | null;

  /** Set to 0 to clear, so the limit is learned again. */
  @Field(() => Int, { nullable: true })
  maxBlockRange?: number | null;

  @Field(() => RpcEndpointTier, { nullable: true })
  tier?: RpcEndpointTier | null;

  /** Parallel requests, 1-64. */
  @Field(() => Int, { nullable: true })
  concurrency?: number | null;
}
