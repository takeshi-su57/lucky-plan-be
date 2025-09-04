import { ObjectType, Field, Int, OmitType } from '@nestjs/graphql';

@ObjectType()
export class Action {
  @Field(() => Int)
  id: number;

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

  @Field(() => Date)
  createdAt: Date;
}

@ObjectType()
export class ActionItem extends OmitType(Action, [
  'id',
  'blockNumber',
  'orderInBlock',
  'createdAt',
]) {}
