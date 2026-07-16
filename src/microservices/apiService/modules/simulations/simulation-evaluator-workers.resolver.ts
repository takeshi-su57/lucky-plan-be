import { UseGuards } from '@nestjs/common';
import { Args, Query, Mutation, Resolver } from '@nestjs/graphql';
import { Platform, UserPermission } from 'generated/prisma/client';

import { PrismaService } from 'src/global/prisma.service';
import { SimulationEvaluatorTaskService } from 'src/microservices/analyticsService/modules/simulationEvaluator/simulation-evaluator-task.service';
import {
  SimulationEvaluatorTaskKind,
  SimulationEvaluatorWorkerPlatformCacheStatus,
} from 'generated/prisma/enums';
import { missingRanges } from 'src/microservices/analyticsService/modules/simulationEvaluator/simulation-evaluator-coverage';
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
        progressPercent: true,
        progressRecords: true,
        progressTotalRecords: true,
        progressBytes: true,
      },
    });
    const taskByWorkerId = new Map(tasks.map((task) => [task.workerId, task]));
    return workers.map((worker) => {
      const task = taskByWorkerId.get(worker.id);
      return {
        ...worker,
        displayName: worker.displayName || `worker-${worker.id.slice(0, 8)}`,
        prebuildProgress: task
          ? {
              taskId: task.id,
              message: task.progressMessage || 'Starting prebuild',
              percent: task.progressPercent,
              records: task.progressRecords.toString(),
              totalRecords: task.progressTotalRecords.toString(),
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

  @Mutation(() => Boolean)
  @Roles(UserPermission.Admin)
  @UseGuards(GqlAuthGuard, RolesGuard)
  removeRejectedSimulationEvaluatorWorker(@Args('workerId') workerId: string) {
    return this.auth.removeRejected(workerId);
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
    const platform = platformText as Platform;
    const fragments =
      await this.prisma.simulationEvaluatorWorkerPlatformCache.findMany({
        where: {
          workerId,
          platform,
          status: SimulationEvaluatorWorkerPlatformCacheStatus.Ready,
          coveredStartAt: { not: null },
          coveredEndAt: { not: null },
        },
        select: { coveredStartAt: true, coveredEndAt: true },
      });
    const missing = missingRanges(
      fragments.map((fragment) => ({
        coveredStartAt: fragment.coveredStartAt!,
        coveredEndAt: fragment.coveredEndAt!,
      })),
      startedAt,
      endedAt,
    );
    const tasks = await Promise.all(
      missing.map((range) =>
        this.tasks.createTask({
          kind: SimulationEvaluatorTaskKind.PrebuildPlatformCache,
          targetWorkerId: workerId,
          platform,
          requiredCacheStartAt: range.coveredStartAt,
          requiredCacheEndAt: range.coveredEndAt,
          rangeStartedAt: range.coveredStartAt,
          rangeEndedAt: range.coveredEndAt,
          input: {
            platform,
            eventLogWindowStartedAt: range.coveredStartAt.toISOString(),
            eventLogWindowEndedAt: range.coveredEndAt.toISOString(),
          },
        }),
      ),
    );
    // The GraphQL contract predates multi-fragment prebuilds. Return all task
    // IDs while callers that only need success can continue ignoring the value.
    return tasks.map((task) => task.id).join(',');
  }
}
