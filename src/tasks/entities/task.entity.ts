import { ObjectType, Field, Int, registerEnumType } from '@nestjs/graphql';
import { TaskStatus } from '@prisma/client';
import { Action } from 'src/actions/entities/action.entity';
import { FollowerActionDetails } from 'src/follower-actions/entities/follower-action.entity';
import { Mission, MissionDetails } from 'src/missions/entities/mission.entity';

registerEnumType(TaskStatus, {
  name: 'TaskStatus',
});

@ObjectType()
export class Task {
  @Field(() => Int)
  id: number;

  @Field(() => Int)
  missionId: number;

  @Field(() => Int)
  actionId: number;

  @Field(() => TaskStatus)
  status: TaskStatus;

  @Field(() => [String])
  logs: string[];

  @Field(() => Date)
  createdAt: Date;
}

@ObjectType()
export class TaskShallowDetails extends Task {
  @Field(() => Mission)
  mission: Mission;

  @Field(() => Action)
  action: Action;
}

@ObjectType()
export class TaskDetails extends Task {
  @Field(() => MissionDetails)
  mission: MissionDetails;

  @Field(() => Action)
  action: Action;
}

@ObjectType()
export class TaskWithActions extends Task {
  @Field(() => Action)
  action: Action;

  @Field(() => [FollowerActionDetails])
  followerActions: FollowerActionDetails[];
}
