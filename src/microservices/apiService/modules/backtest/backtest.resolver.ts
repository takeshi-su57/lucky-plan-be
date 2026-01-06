import {
  Resolver,
  Query,
  Mutation,
  Args,
  Int,
  ID,
  Subscription,
} from '@nestjs/graphql';
import { Inject, UseGuards, NotFoundException } from '@nestjs/common';
import { PubSub } from 'graphql-subscriptions';
import { BacktestTaskStatus } from 'generated/prisma/client';

import { BacktestService } from './backtest.service';
import { BacktestRunnerService } from './backtest-runner.service';
import { BacktestTask, TaskStats, BacktestComponents } from './entities';
import { BacktestResult, ResultFolder, ResultFile } from './entities';
import { CreateBacktestTaskInput } from './dto';

import { PUB_SUB } from 'src/global/global.module';
import { SUBSCRIPTION_TOKEN } from 'src/utils/constants';
import { GqlAuthGuard } from 'src/microservices/apiService/modules/auth/gql-auth.guard';
import { RolesGuard } from 'src/microservices/apiService/modules/auth/gql-role.guard';
import { Roles } from 'src/microservices/apiService/modules/auth/roles.decorator';
import { UserPermission } from 'generated/prisma/client';

@Resolver()
export class BacktestResolver {
  constructor(
    private readonly backtestService: BacktestService,
    private readonly backtestRunnerService: BacktestRunnerService,
    @Inject(PUB_SUB) private readonly pubSub: PubSub,
  ) {}

  // ==================== COMPONENT QUERIES ====================

  @Query(() => BacktestComponents, {
    description: 'Get available backtest components with their parameters',
  })
  backtestComponents(): BacktestComponents {
    return this.backtestService.getComponents();
  }

  // ==================== TASK QUERIES ====================

  @Query(() => BacktestTask, {
    nullable: true,
    description: 'Get a single backtest task by ID',
  })
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  async backtestTask(
    @Args('id', { type: () => ID }) id: string,
  ): Promise<BacktestTask | null> {
    return this.backtestService.getTask(id);
  }

  @Query(() => [BacktestTask], {
    description: 'List backtest tasks with optional filtering',
  })
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  async backtestTasks(
    @Args('status', { type: () => BacktestTaskStatus, nullable: true })
    status?: BacktestTaskStatus,
    @Args('symbol', { nullable: true }) symbol?: string,
    @Args('limit', { type: () => Int, defaultValue: 20 }) limit?: number,
    @Args('offset', { type: () => Int, defaultValue: 0 }) offset?: number,
  ): Promise<BacktestTask[]> {
    return this.backtestService.getTasks({ status, symbol, limit, offset });
  }

  @Query(() => TaskStats, {
    description: 'Get task count statistics by status',
  })
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  async backtestTaskStats(): Promise<TaskStats> {
    return this.backtestService.getTaskStats();
  }

  // ==================== TASK MUTATIONS ====================

  @Mutation(() => BacktestTask, {
    description: 'Create a new backtest optimization task',
  })
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  async createBacktestTask(
    @Args('input') input: CreateBacktestTaskInput,
  ): Promise<BacktestTask> {
    return this.backtestService.createTask(input);
  }

  @Mutation(() => BacktestTask, {
    description: 'Cancel a running or pending backtest task',
  })
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  async cancelBacktestTask(
    @Args('taskId', { type: () => ID }) taskId: string,
  ): Promise<BacktestTask> {
    // Signal runner to stop
    this.backtestRunnerService.stopProcessing();
    return this.backtestService.cancelTask(taskId);
  }

  @Mutation(() => Boolean, {
    description: 'Delete a backtest task and its results',
  })
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  async deleteBacktestTask(
    @Args('taskId', { type: () => ID }) taskId: string,
  ): Promise<boolean> {
    return this.backtestService.deleteTask(taskId);
  }

  @Mutation(() => Boolean, {
    description: 'Delete a single backtest result',
  })
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  async deleteBacktestResult(
    @Args('resultId', { type: () => ID }) resultId: string,
  ): Promise<boolean> {
    return this.backtestService.deleteResult(resultId);
  }

  @Mutation(() => BacktestTask, {
    description: 'Retry a failed backtest task',
  })
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  async retryBacktestTask(
    @Args('taskId', { type: () => ID }) taskId: string,
  ): Promise<BacktestTask> {
    return this.backtestService.retryTask(taskId);
  }

  // ==================== RESULT QUERIES ====================

  @Query(() => [BacktestResult], {
    description: 'Get backtest results for a task with sorting and pagination',
  })
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  async backtestResults(
    @Args('taskId', { type: () => ID }) taskId: string,
    @Args('sortBy', { defaultValue: 'totalPnlUsdt' }) sortBy?: string,
    @Args('sortOrder', { defaultValue: 'desc' }) sortOrder?: string,
    @Args('limit', { type: () => Int, defaultValue: 50 }) limit?: number,
    @Args('offset', { type: () => Int, defaultValue: 0 }) offset?: number,
  ): Promise<BacktestResult[]> {
    return this.backtestService.getResults({
      taskId,
      sortBy,
      sortOrder: sortOrder as 'asc' | 'desc',
      limit,
      offset,
    });
  }

  @Query(() => [BacktestResult], {
    description: 'Get top performing backtest results',
  })
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  async topBacktestResults(
    @Args('taskId', { type: () => ID }) taskId: string,
    @Args('metric', { defaultValue: 'totalPnlUsdt' }) metric?: string,
    @Args('limit', { type: () => Int, defaultValue: 10 }) limit?: number,
  ): Promise<BacktestResult[]> {
    return this.backtestService.getTopResults(taskId, metric, limit);
  }

  // ==================== FILE NAVIGATION QUERIES ====================

  @Query(() => [String], {
    description: 'Get list of result dates for a task',
  })
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  backtestResultDates(
    @Args('taskId', { type: () => ID }) taskId: string,
  ): string[] {
    return this.backtestService.getResultDates(taskId);
  }

  @Query(() => [ResultFolder], {
    description: 'Get list of result folders for a task and date',
  })
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  backtestResultFolders(
    @Args('taskId', { type: () => ID }) taskId: string,
    @Args('date') date: string,
  ): ResultFolder[] {
    return this.backtestService.getResultFolders(taskId, date);
  }

  @Query(() => ResultFile, {
    nullable: true,
    description: 'Get a specific result file',
  })
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  backtestResultFile(
    @Args('taskId', { type: () => ID }) taskId: string,
    @Args('date') date: string,
    @Args('configId') configId: string,
    @Args('fileName') fileName: string,
  ): ResultFile | null {
    const result = this.backtestService.getResultFile(
      taskId,
      date,
      configId,
      fileName,
    );

    if (!result) {
      throw new NotFoundException(
        `File not found: ${taskId}/${date}/${configId}/${fileName}`,
      );
    }

    return result;
  }

  // ==================== SUBSCRIPTIONS ====================

  @Subscription(() => BacktestTask, {
    name: SUBSCRIPTION_TOKEN.backtestTaskUpdated,
    description: 'Subscribe to backtest task progress updates',
  })
  subscribeToBacktestTaskUpdated() {
    return this.pubSub.asyncIterableIterator(
      SUBSCRIPTION_TOKEN.backtestTaskUpdated,
    );
  }

  @Subscription(() => BacktestResult, {
    name: SUBSCRIPTION_TOKEN.backtestResultCreated,
    description: 'Subscribe to new backtest results',
  })
  subscribeToBacktestResultCreated() {
    return this.pubSub.asyncIterableIterator(
      SUBSCRIPTION_TOKEN.backtestResultCreated,
    );
  }
}
