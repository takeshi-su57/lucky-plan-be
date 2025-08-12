import { ObjectType, Field, Int, OmitType } from '@nestjs/graphql';
import {
  Position,
  PositionInfo,
} from 'src/microservices/apiService/modules/positions/entities/position.entity';

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

  @Field(() => Int)
  blockNumber: number;

  @Field(() => Int)
  orderInBlock: number;

  @Field(() => Date)
  createdAt: Date;
}

@ObjectType()
export class ActionDetails extends Action {
  @Field(() => Position)
  position: Position;
}

@ObjectType()
export class ActionItem extends OmitType(Action, [
  'id',
  'positionId',
  'blockNumber',
  'orderInBlock',
  'createdAt',
]) {
  @Field(() => PositionInfo)
  position: PositionInfo;
}
