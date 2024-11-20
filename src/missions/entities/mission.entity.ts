import { ObjectType, Field, Int } from '@nestjs/graphql';
import { MissionStatus } from '@prisma/client';
import { BotDetails } from 'src/bots/entities/bot.entity';
import { Position } from 'src/positions/entities/position.entity';

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

  @Field()
  status: MissionStatus;
}

@ObjectType()
export class MissionShallowDetails extends Mission {
  @Field(() => Position)
  targetPosition: Position;

  @Field(() => Position, { nullable: true })
  achievePosition: Position | null;
}

@ObjectType()
export class MissionDetails extends MissionShallowDetails {
  @Field(() => BotDetails)
  bot: BotDetails;
}
