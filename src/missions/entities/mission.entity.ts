import {
  ObjectType,
  Field,
  Int,
  registerEnumType,
  InputType,
} from '@nestjs/graphql';
import { MissionStatus } from '@prisma/client';
import { IsNotEmpty } from 'class-validator';
import { BotBackwardDetails, BotDetails } from 'src/bots/entities/bot.entity';

import { Position } from 'src/positions/entities/position.entity';
import { TaskForwardDetails } from 'src/tasks/entities/task.entity';

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
export class MissionDetails extends Mission {
  @Field(() => Position)
  targetPosition: Position;

  @Field(() => Position, { nullable: true })
  achievePosition: Position | null;
}

@ObjectType()
export class MissionShallowBackwardDetails extends MissionDetails {
  @Field(() => BotDetails)
  bot: BotDetails;
}

@ObjectType()
export class MissionBackwardDetails extends MissionDetails {
  @Field(() => BotBackwardDetails)
  bot: BotBackwardDetails;
}

@ObjectType()
export class MissionForwardDetails extends MissionDetails {
  @Field(() => [TaskForwardDetails])
  tasks: TaskForwardDetails[];
}

@InputType()
export class ManualParams {
  @IsNotEmpty()
  @Field()
  collateralAmount: string;

  @IsNotEmpty()
  @Field()
  leverage: number;

  @IsNotEmpty()
  @Field()
  long: boolean;
}
