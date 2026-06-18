import { ObjectType, Field, Int, OmitType } from '@nestjs/graphql';
import { ActionOrigin, ActionStatus } from 'generated/prisma/client';

@ObjectType()
export class Action {
  @Field(() => Int)
  id: number;

  @Field(() => Int, { nullable: true })
  contractId?: number | null;

  @Field(() => String)
  origin: ActionOrigin;

  @Field(() => String)
  status: ActionStatus;

  @Field()
  name: string;

  @Field(() => String)
  positionKey: string;

  @Field()
  args: string;

  @Field()
  address: string;

  @Field(() => Int)
  blockNumber: number;

  @Field(() => Int)
  orderInBlock: number;

  @Field(() => String, { nullable: true })
  blockHash?: string | null;

  @Field(() => String, { nullable: true })
  txHash?: string | null;

  @Field(() => String, { nullable: true })
  dedupeKey?: string | null;

  @Field(() => Date)
  createdAt: Date;
}

@ObjectType()
export class ActionItem extends OmitType(Action, [
  'id',
  'contractId',
  'origin',
  'status',
  'blockNumber',
  'orderInBlock',
  'blockHash',
  'txHash',
  'dedupeKey',
  'createdAt',
]) {}
