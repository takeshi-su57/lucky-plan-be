import { Resolver, Mutation, Args, Int } from '@nestjs/graphql';
import { TaskExecutorService } from './task-executor.service';

import { TaskShallowDetails } from 'src/tasks/entities/task.entity';

@Resolver()
export class TaskExecutorResolver {
  constructor(private readonly taskExecutorService: TaskExecutorService) {}

  @Mutation(() => TaskShallowDetails)
  performTask(@Args('id', { type: () => Int }) id: number) {
    return this.taskExecutorService.performTaskById(id);
  }
}
