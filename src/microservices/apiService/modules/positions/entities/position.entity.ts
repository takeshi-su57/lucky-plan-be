import { ObjectType, Field, Int, OmitType } from '@nestjs/graphql';

@ObjectType()
export class Position {
  @Field(() => Int)
  id: number;

  @Field(() => Int)
  contractId: number;

  @Field()
  address: string;

  @Field(() => Int)
  index: number;
}

@ObjectType()
export class PositionInfo extends OmitType(Position, ['id']) {}
