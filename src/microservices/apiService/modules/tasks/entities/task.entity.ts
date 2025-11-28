import { ObjectType, Field, Int, registerEnumType } from '@nestjs/graphql';
import { TaskStatus } from 'generated/prisma/client';
import { Action } from 'src/microservices/apiService/modules/actions/entities/action.entity';
import { FollowerActionDetails } from 'src/microservices/apiService/modules/follower-actions/entities/follower-action.entity';
import {
  Mission,
  MissionBackwardDetails,
  MissionShallowBackwardDetails,
} from 'src/microservices/apiService/modules/missions/entities/mission.entity';

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
export class TaskDetails extends Task {
  @Field(() => Mission)
  mission: Mission;

  @Field(() => Action)
  action: Action;
}

@ObjectType()
export class TaskForwardDetails extends Task {
  @Field(() => Action)
  action: Action;

  @Field(() => [FollowerActionDetails])
  followerActions: FollowerActionDetails[];
}

@ObjectType()
export class TaskShallowBackwardDetails extends TaskForwardDetails {
  @Field(() => MissionShallowBackwardDetails)
  mission: MissionShallowBackwardDetails;
}

@ObjectType()
export class TaskBackwardDetails extends TaskForwardDetails {
  @Field(() => MissionBackwardDetails)
  mission: MissionBackwardDetails;
}
