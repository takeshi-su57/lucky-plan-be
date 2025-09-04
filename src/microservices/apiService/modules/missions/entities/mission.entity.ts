import {
  ObjectType,
  Field,
  Int,
  registerEnumType,
  InputType,
} from '@nestjs/graphql';
import { MissionStatus } from '@prisma/client';
import { IsNotEmpty } from 'class-validator';
import {
  BotBackwardDetails,
  BotDetails,
} from 'src/microservices/apiService/modules/bots/entities/bot.entity';

import { TaskForwardDetails } from 'src/microservices/apiService/modules/tasks/entities/task.entity';

registerEnumType(MissionStatus, {
  name: 'MissionStatus',
});

@ObjectType()
export class Mission {
  @Field(() => Int)
  id: number;

  @Field(() => Int)
  botId: number;

  @Field(() => String)
  targetPositionKey: string;

  @Field(() => Int)
  targetPositionBlockNumber: number;

  @Field(() => Int)
  targetPositionLogIndex: number;

  @Field(() => String, { nullable: true })
  achievePositionKey: string | null;

  @Field(() => Int, { nullable: true })
  achievePositionBlockNumber: number | null;

  @Field(() => Int, { nullable: true })
  achievePositionLogIndex: number | null;

  @Field(() => Date)
  createdAt: Date;

  @Field(() => Date)
  updatedAt: Date;

  @Field(() => MissionStatus)
  status: MissionStatus;
}

@ObjectType()
export class MissionShallowBackwardDetails extends Mission {
  @Field(() => BotDetails)
  bot: BotDetails;
}

@ObjectType()
export class MissionBackwardDetails extends Mission {
  @Field(() => BotBackwardDetails)
  bot: BotBackwardDetails;
}

@ObjectType()
export class MissionForwardDetails extends Mission {
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
