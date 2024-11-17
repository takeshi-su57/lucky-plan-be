import { ObjectType, Field, Int } from '@nestjs/graphql';
import { Action } from 'src/actions/entities/action.entity';
import { Task } from 'src/tasks/entities/task.entity';

@ObjectType()
export class FollowerAction {
  @Field(() => Int)
  id: number;

  @Field(() => Int)
  actionId: number;

  @Field(() => Int)
  taskId: number;
}

@ObjectType()
export class FollowerActionDetails extends FollowerAction {
  @Field(() => Action)
  action: Action;

  @Field(() => Task)
  task: Task;
}
