import { ObjectType, Field, Int, OmitType } from '@nestjs/graphql';
import { Position, PositionInfo } from 'src/positions/entities/position.entity';

@ObjectType()
export class Action {
  @Field(() => Int)
  id: number;

  @Field()
  name: string;

  @Field(() => Int)
  positionId: number;

  @Field()
  args: string;

  @Field(() => Date)
  createdAt: Date;
}

@ObjectType()
export class ActionDetail extends Action {
  @Field(() => Position)
  position: Position;
}

@ObjectType()
export class ActionItem extends OmitType(Action, [
  'id',
  'positionId',
  'createdAt',
]) {
  @Field(() => PositionInfo)
  position: PositionInfo;
}
