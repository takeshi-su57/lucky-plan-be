import { Resolver, Mutation, Args, Int } from '@nestjs/graphql';
import { TaskExecutorService } from './task-executor.service';
import { GqlAuthGuard } from 'src/auth/gql-auth.guard';
import { UseGuards } from '@nestjs/common';

@Resolver()
export class TaskExecutorResolver {
  constructor(private readonly taskExecutorService: TaskExecutorService) {}

  @Mutation(() => Boolean)
  @UseGuards(GqlAuthGuard)
  performTask(@Args('id', { type: () => Int }) id: number) {
    return this.taskExecutorService.performTaskById(id);
  }
}
