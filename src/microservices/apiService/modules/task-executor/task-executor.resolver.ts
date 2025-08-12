import { Resolver, Mutation, Args, Int } from '@nestjs/graphql';
import { TaskExecutorService } from './task-executor.service';
import { GqlAuthGuard } from 'src/microservices/apiService/modules/auth/gql-auth.guard';
import { UseGuards } from '@nestjs/common';
import { CurrentUser } from 'src/microservices/apiService/modules/auth/user.decorator';
import { User, UserPermission } from '@prisma/client';
import { Roles } from 'src/microservices/apiService/modules/auth/roles.decorator';
import { RolesGuard } from 'src/microservices/apiService/modules/auth/gql-role.guard';

@Resolver()
export class TaskExecutorResolver {
  constructor(private readonly taskExecutorService: TaskExecutorService) {}

  @Mutation(() => Boolean)
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  performTask(
    @Args('id', { type: () => Int }) id: number,
    @CurrentUser() user: User,
  ) {
    return this.taskExecutorService.performTaskById(user.address, id);
  }
}
