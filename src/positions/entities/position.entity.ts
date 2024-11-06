import { ObjectType, Field, Int, OmitType } from '@nestjs/graphql';
import { Address } from 'viem';

@ObjectType()
export class Position {
  @Field(() => Int)
  id: number;

  @Field()
  address: Address;

  @Field(() => Int)
  index: number;
}

@ObjectType()
export class PositionInfo extends OmitType(Position, ['id']) {}
