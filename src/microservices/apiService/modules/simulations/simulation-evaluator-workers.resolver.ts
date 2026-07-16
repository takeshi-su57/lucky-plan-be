import { UseGuards } from '@nestjs/common';
import { Args, Query, Mutation, Resolver } from '@nestjs/graphql';
import { Platform, UserPermission } from 'generated/prisma/client';

import { PrismaService } from 'src/global/prisma.service';
import { SimulationEvaluatorTaskService } from 'src/microservices/analyticsService/modules/simulationEvaluator/simulation-evaluator-task.service';
import { SimulationEvaluatorTaskKind } from 'generated/prisma/enums';
import { GqlAuthGuard } from '../auth/gql-auth.guard';
import { RolesGuard } from '../auth/gql-role.guard';
import { Roles } from '../auth/roles.decorator';
import { SimulationEvaluatorWorkerAuthService } from './simulation-evaluator-worker-auth.service';
import { SimulationEvaluatorWorkerView } from './entities/simulations.entity';

@Resolver()
export class SimulationEvaluatorWorkersResolver {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: SimulationEvaluatorWorkerAuthService,
    private readonly tasks: SimulationEvaluatorTaskService,
  ) {}

  @Query(() => [SimulationEvaluatorWorkerView])
  @Roles(UserPermission.Admin)
  @UseGuards(GqlAuthGuard, RolesGuard)
  async simulationEvaluatorWorkers() {
    await this.auth.reconcileOfflineWorkers();
    const workers = await this.prisma.simulationEvaluatorWorker.findMany({
      include: { platformCaches: true },
      orderBy: { createdAt: 'asc' },
    });
    const tasks = await this.prisma.simulationEvaluatorTask.findMany({
      where: {
        kind: SimulationEvaluatorTaskKind.PrebuildPlatformCache,
        status: 'Claimed',
        workerId: { in: workers.map((worker) => worker.id) },
      },
      select: {
        id: true,
        workerId: true,
        progressMessage: true,
        progressRecords: true,
        progressBytes: true,
      },
    });
    const taskByWorkerId = new Map(tasks.map((task) => [task.workerId, task]));
    return workers.map((worker) => {
      const task = taskByWorkerId.get(worker.id);
      return {
        ...worker,
        prebuildProgress: task
          ? {
              taskId: task.id,
              message: task.progressMessage || 'Starting prebuild',
              records: task.progressRecords.toString(),
              bytes: task.progressBytes.toString(),
            }
          : undefined,
      };
    });
  }

  @Mutation(() => SimulationEvaluatorWorkerView)
  @Roles(UserPermission.Admin)
  @UseGuards(GqlAuthGuard, RolesGuard)
  approveSimulationEvaluatorWorker(@Args('workerId') workerId: string) {
    return this.auth.approve(workerId);
  }

  @Mutation(() => SimulationEvaluatorWorkerView)
  @Roles(UserPermission.Admin)
  @UseGuards(GqlAuthGuard, RolesGuard)
  rejectSimulationEvaluatorWorker(@Args('workerId') workerId: string) {
    return this.auth.reject(workerId);
  }

  @Mutation(() => String)
  @Roles(UserPermission.Admin)
  @UseGuards(GqlAuthGuard, RolesGuard)
  async prebuildSimulationEvaluatorWorker(
    @Args('workerId') workerId: string,
    @Args('platform') platformText: string,
    @Args('startedAt') startedAtText: string,
    @Args('endedAt') endedAtText: string,
  ) {
    if (!Object.values(Platform).includes(platformText as Platform))
      throw new Error('Invalid platform');
    const startedAt = new Date(startedAtText);
    const endedAt = new Date(endedAtText);
    if (
      Number.isNaN(+startedAt) ||
      Number.isNaN(+endedAt) ||
      startedAt >= endedAt
    )
      throw new Error('Invalid cache range');
    const task = await this.tasks.createTask({
      kind: SimulationEvaluatorTaskKind.PrebuildPlatformCache,
      targetWorkerId: workerId,
      platform: platformText as Platform,
      requiredCacheStartAt: startedAt,
      requiredCacheEndAt: endedAt,
      rangeStartedAt: startedAt,
      rangeEndedAt: endedAt,
      input: {
        platform: platformText,
        eventLogWindowStartedAt: startedAt.toISOString(),
        eventLogWindowEndedAt: endedAt.toISOString(),
      },
    });
    return task.id;
  }
}
