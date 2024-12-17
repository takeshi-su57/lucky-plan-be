import {
  ObjectType,
  Field,
  Int,
  registerEnumType,
  OmitType,
} from '@nestjs/graphql';
import { MissionStatus } from '@prisma/client';
import { Bot, BotDetails } from 'src/bots/entities/bot.entity';
import { Position } from 'src/positions/entities/position.entity';

registerEnumType(MissionStatus, {
  name: 'MissionStatus',
});

@ObjectType()
export class Mission {
  @Field(() => Int)
  id: number;

  @Field(() => Int)
  botId: number;

  @Field(() => Int)
  targetPositionId: number;

  @Field(() => Int, { nullable: true })
  achievePositionId: number | null;

  @Field(() => Date)
  createdAt: Date;

  @Field(() => Date)
  updatedAt: Date;

  @Field(() => MissionStatus)
  status: MissionStatus;
}

@ObjectType()
export class MissionShallowDetails extends Mission {
  @Field(() => Position)
  targetPosition: Position;

  @Field(() => Position, { nullable: true })
  achievePosition: Position | null;

  @Field(() => Bot)
  bot: Bot;
}

@ObjectType()
export class MissionDetails extends OmitType(MissionShallowDetails, ['bot']) {
  @Field(() => BotDetails)
  bot: BotDetails;
}
