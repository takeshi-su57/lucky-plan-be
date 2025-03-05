import { Resolver, Mutation, Args, Int } from '@nestjs/graphql';
import { TaskExecutorService } from './task-executor.service';

@Resolver()
export class TaskExecutorResolver {
  constructor(private readonly taskExecutorService: TaskExecutorService) {}

  @Mutation(() => Boolean)
  performTask(@Args('id', { type: () => Int }) id: number) {
    return this.taskExecutorService.performTaskById(id);
  }
}
