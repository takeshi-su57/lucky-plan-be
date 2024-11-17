import { ObjectType, Field, Int } from '@nestjs/graphql';
import { TaskStatus } from '@prisma/client';
import { Action } from 'src/actions/entities/action.entity';
import { MissionDetails } from 'src/missions/entities/mission.entity';

@ObjectType()
export class Task {
  @Field(() => Int)
  id: number;

  @Field(() => Int)
  missionId: number;

  @Field(() => Int)
  actionId: number;

  @Field()
  status: TaskStatus;

  @Field(() => [String])
  logs: string[];

  @Field(() => Date)
  createdAt: Date;
}

@ObjectType()
export class TaskDetails extends Task {
  @Field(() => MissionDetails)
  mission: MissionDetails;

  @Field(() => Action)
  action: Action;
}
