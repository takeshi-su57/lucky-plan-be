import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  ValidationPipelineStatus,
  ValidationCandidateStatus,
} from 'generated/prisma/client';
import { firstValueFrom } from 'rxjs';

import { PrismaService } from 'src/global/prisma.service';
import { LogsService } from 'src/global/logs.service';
import { PATTERNS, SERVICE_NAMES } from 'src/utils/constants';
import { getReadableError } from 'src/utils';

import {
  CreateValidationPipelineInput,
  ValidationPipelineFilterInput,
  ValidationCandidateFilterInput,
  UserSelectionInput,
  FinalApprovalInput,
} from './dto';
import {
  ValidationPipeline,
  ValidationPipelineWithCandidates,
  ValidationPipelineStats,
  ValidationCandidateWithResult,
  PaginatedValidationCandidatesResult,
  ThresholdStep,
  ThresholdPreviewResult,
  ParetoStep,
  ParetoPreviewResult,
} from './entities';
import { ThresholdFilterService } from './threshold-filter.service';
import { ParetoSelectionService } from './pareto-selection.service';
import { WalkForwardService, WfaConfigWithState } from './walk-forward.service';
import { RobustnessTestService } from './robustness-test.service';

@Injectable()
export class ValidationPipelineService {
  constructor(
    @Inject(SERVICE_NAMES.REDIS_SERVICE) private redisClient: ClientProxy,
    private readonly prismaService: PrismaService,
    private readonly logger: LogsService,
    private readonly thresholdService: ThresholdFilterService,
    private readonly paretoService: ParetoSelectionService,
    private readonly wfaService: WalkForwardService,
    private readonly robustnessService: RobustnessTestService,
  ) {}

  // ==================== PIPELINE CRUD ====================

  async createPipeline(
    input: CreateValidationPipelineInput,
  ): Promise<ValidationPipeline> {
    const task = await this.prismaService.backtestTask.findUnique({
      where: { id: input.backtestTaskId },
      include: { results: true },
    });

    if (!task) {
      throw new NotFoundException(
        `BacktestTask ${input.backtestTaskId} not found`,
      );
    }

    if (task.status !== 'DONE') {
      throw new BadRequestException(
        'BacktestTask must be in DONE status to create a validation pipeline',
      );
    }

    if (task.results.length === 0) {
      throw new BadRequestException(
        'BacktestTask has no backtest results to validate',
      );
    }

    const pipeline = await this.prismaService.$transaction(async (tx) => {
      const newPipeline = await tx.validationPipeline.create({
        data: {
          name: input.name,
          backtestTaskId: input.backtestTaskId,
          status: ValidationPipelineStatus.STEP_THRESHOLD,
          currentStep: 2,
          totalCandidates: task.results.length,
        },
      });

      const candidateData = task.results.map((result) => ({
        pipelineId: newPipeline.id,
        resultId: result.id,
        configId: result.configId,
        status: ValidationCandidateStatus.PENDING,
      }));

      await tx.validationCandidate.createMany({ data: candidateData });

      return newPipeline;
    });

    await firstValueFrom(
      this.redisClient.emit(PATTERNS.Validation.PipelineCreated, pipeline),
    );

    return pipeline;
  }

  async getPipeline(id: string): Promise<ValidationPipeline | null> {
    return this.prismaService.validationPipeline.findUnique({
      where: { id },
    });
  }

  async getPipelineWithCandidates(
    id: string,
  ): Promise<ValidationPipelineWithCandidates | null> {
    return this.prismaService.validationPipeline.findUnique({
      where: { id },
      include: {
        candidates: { orderBy: { createdAt: 'asc' } },
      },
    });
  }

  async getPipelines(
    filter?: ValidationPipelineFilterInput,
  ): Promise<ValidationPipeline[]> {
    return this.prismaService.validationPipeline.findMany({
      where: {
        ...(filter?.status && { status: filter.status }),
        ...(filter?.backtestTaskId && {
          backtestTaskId: filter.backtestTaskId,
        }),
      },
      orderBy: { createdAt: 'desc' },
      take: filter?.limit || 20,
      skip: filter?.offset || 0,
    });
  }

  async getPipelineStats(): Promise<ValidationPipelineStats> {
    const [created, inProgress, awaitingUser, completed, failed, cancelled] =
      await Promise.all([
        this.prismaService.validationPipeline.count({
          where: { status: ValidationPipelineStatus.CREATED },
        }),
        this.prismaService.validationPipeline.count({
          where: {
            status: {
              in: [
                ValidationPipelineStatus.STEP_THRESHOLD,
                ValidationPipelineStatus.STEP_PARETO,
                ValidationPipelineStatus.STEP_WFA,
                ValidationPipelineStatus.STEP_ROBUSTNESS,
              ],
            },
          },
        }),
        this.prismaService.validationPipeline.count({
          where: {
            status: {
              in: [
                ValidationPipelineStatus.STEP_USER_SELECTION,
                ValidationPipelineStatus.STEP_FINAL_APPROVAL,
              ],
            },
          },
        }),
        this.prismaService.validationPipeline.count({
          where: { status: ValidationPipelineStatus.COMPLETED },
        }),
        this.prismaService.validationPipeline.count({
          where: { status: ValidationPipelineStatus.FAILED },
        }),
        this.prismaService.validationPipeline.count({
          where: { status: ValidationPipelineStatus.CANCELLED },
        }),
      ]);

    return { created, inProgress, awaitingUser, completed, failed, cancelled };
  }

  async updateStatus(
    id: string,
    status: ValidationPipelineStatus,
    errorMessage?: string,
  ): Promise<ValidationPipeline> {
    const updateData: Record<string, unknown> = { status };

    if (status === ValidationPipelineStatus.STEP_THRESHOLD) {
      updateData.startedAt = new Date();
    }

    if (
      status === ValidationPipelineStatus.COMPLETED ||
      status === ValidationPipelineStatus.FAILED ||
      status === ValidationPipelineStatus.CANCELLED
    ) {
      updateData.completedAt = new Date();
    }

    if (errorMessage) {
      updateData.errorMessage = errorMessage;
    }

    const pipeline = await this.prismaService.validationPipeline.update({
      where: { id },
      data: updateData,
    });

    await firstValueFrom(
      this.redisClient.emit(PATTERNS.Validation.PipelineUpdated, pipeline),
    );

    return pipeline;
  }

  async updateStats(id: string): Promise<ValidationPipeline> {
    const stats = await this.prismaService.validationCandidate.groupBy({
      by: ['status'],
      where: { pipelineId: id },
      _count: true,
    });

    const statMap = new Map(stats.map((s) => [s.status, s._count]));

    const activeStatuses = [
      ValidationCandidateStatus.ACTIVE,
      ValidationCandidateStatus.PARETO_OPTIMAL,
      ValidationCandidateStatus.PARETO_DOMINATED,
      ValidationCandidateStatus.WFA_PASSED,
      ValidationCandidateStatus.WFA_FAILED,
      ValidationCandidateStatus.USER_SELECTED,
      ValidationCandidateStatus.USER_REJECTED,
      ValidationCandidateStatus.ROBUSTNESS_PASSED,
      ValidationCandidateStatus.ROBUSTNESS_FAILED,
      ValidationCandidateStatus.FINAL_APPROVED,
      ValidationCandidateStatus.FINAL_REJECTED,
    ];

    const paretoForwardStatuses = [
      ValidationCandidateStatus.PARETO_OPTIMAL,
      ValidationCandidateStatus.WFA_PASSED,
      ValidationCandidateStatus.WFA_FAILED,
      ValidationCandidateStatus.USER_SELECTED,
      ValidationCandidateStatus.USER_REJECTED,
      ValidationCandidateStatus.ROBUSTNESS_PASSED,
      ValidationCandidateStatus.ROBUSTNESS_FAILED,
      ValidationCandidateStatus.FINAL_APPROVED,
      ValidationCandidateStatus.FINAL_REJECTED,
    ];

    const wfaForwardStatuses = [
      ValidationCandidateStatus.WFA_PASSED,
      ValidationCandidateStatus.USER_SELECTED,
      ValidationCandidateStatus.USER_REJECTED,
      ValidationCandidateStatus.ROBUSTNESS_PASSED,
      ValidationCandidateStatus.ROBUSTNESS_FAILED,
      ValidationCandidateStatus.FINAL_APPROVED,
      ValidationCandidateStatus.FINAL_REJECTED,
    ];

    const userForwardStatuses = [
      ValidationCandidateStatus.USER_SELECTED,
      ValidationCandidateStatus.ROBUSTNESS_PASSED,
      ValidationCandidateStatus.ROBUSTNESS_FAILED,
      ValidationCandidateStatus.FINAL_APPROVED,
      ValidationCandidateStatus.FINAL_REJECTED,
    ];

    const robustnessForwardStatuses = [
      ValidationCandidateStatus.ROBUSTNESS_PASSED,
      ValidationCandidateStatus.FINAL_APPROVED,
      ValidationCandidateStatus.FINAL_REJECTED,
    ];

    const sumStatuses = (statuses: ValidationCandidateStatus[]) =>
      statuses.reduce((sum, s) => sum + (statMap.get(s) || 0), 0);

    const totalCandidates = stats.reduce((sum, s) => sum + s._count, 0);

    const pipeline = await this.prismaService.validationPipeline.update({
      where: { id },
      data: {
        totalCandidates,
        passedThreshold: sumStatuses(activeStatuses),
        paretoOptimal: sumStatuses(paretoForwardStatuses),
        passedWfa: sumStatuses(wfaForwardStatuses),
        userSelected: sumStatuses(userForwardStatuses),
        passedRobustness: sumStatuses(robustnessForwardStatuses),
        finalApproved: statMap.get(ValidationCandidateStatus.FINAL_APPROVED) || 0,
      },
    });

    await firstValueFrom(
      this.redisClient.emit(PATTERNS.Validation.PipelineUpdated, pipeline),
    );

    return pipeline;
  }

  async cancelPipeline(id: string): Promise<ValidationPipeline> {
    const pipeline = await this.prismaService.validationPipeline.findUnique({
      where: { id },
    });

    if (!pipeline) {
      throw new NotFoundException(`Pipeline ${id} not found`);
    }

    if (
      pipeline.status === ValidationPipelineStatus.COMPLETED ||
      pipeline.status === ValidationPipelineStatus.FAILED ||
      pipeline.status === ValidationPipelineStatus.CANCELLED
    ) {
      throw new BadRequestException(
        `Cannot cancel pipeline in ${pipeline.status} status`,
      );
    }

    return this.updateStatus(id, ValidationPipelineStatus.CANCELLED);
  }

  async deletePipeline(id: string): Promise<boolean> {
    const pipeline = await this.prismaService.validationPipeline.findUnique({
      where: { id },
    });

    if (!pipeline) {
      throw new NotFoundException(`Pipeline ${id} not found`);
    }

    await this.prismaService.validationPipeline.delete({ where: { id } });
    return true;
  }

  async getCandidatesByStatus(
    filter: ValidationCandidateFilterInput,
  ): Promise<PaginatedValidationCandidatesResult> {
    const where = {
      pipelineId: filter.pipelineId,
      ...(filter.status && { status: filter.status }),
    };

    const [candidates, totalCount] = await Promise.all([
      this.prismaService.validationCandidate.findMany({
        where,
        include: { result: true },
        orderBy: { createdAt: 'asc' },
        take: filter.limit || 100,
        skip: filter.offset || 0,
      }),
      this.prismaService.validationCandidate.count({ where }),
    ]);

    return { candidates, totalCount };
  }

  async getCandidateWithDetails(id: string) {
    return this.prismaService.validationCandidate.findUnique({
      where: { id },
      include: { result: true },
    });
  }

  // ==================== STEP 2: THRESHOLD ====================

  async applyThresholdStep(
    pipelineId: string,
    metricName: string,
    operator: string,
    value: number,
  ): Promise<ValidationPipeline> {
    const pipeline = await this.requirePipeline(pipelineId);
    this.requireStatus(pipeline, ValidationPipelineStatus.STEP_THRESHOLD);

    const result = await this.thresholdService.applySingleThreshold(
      pipelineId,
      metricName,
      operator,
      value,
    );

    const existingSteps = await this.prismaService.thresholdStep.count({
      where: { pipelineId },
    });

    await this.prismaService.thresholdStep.create({
      data: {
        pipelineId,
        stepOrder: existingSteps + 1,
        metricName,
        operator,
        value,
        candidatesBefore: result.candidatesBefore,
        candidatesAfter: result.candidatesAfter,
      },
    });

    await this.updateStats(pipelineId);
    return this.getPipeline(pipelineId) as Promise<ValidationPipeline>;
  }

  async previewThresholdStep(
    pipelineId: string,
    metricName: string,
    operator: string,
    value: number,
  ): Promise<ThresholdPreviewResult> {
    await this.requirePipeline(pipelineId);

    return this.thresholdService.previewSingleThreshold(
      pipelineId,
      metricName,
      operator,
      value,
    );
  }

  async removeThresholdStep(
    pipelineId: string,
    stepId: string,
  ): Promise<ValidationPipeline> {
    const pipeline = await this.requirePipeline(pipelineId);
    this.requireStatus(pipeline, ValidationPipelineStatus.STEP_THRESHOLD);

    await this.prismaService.thresholdStep.delete({
      where: { id: stepId },
    });

    const remainingSteps = await this.prismaService.thresholdStep.findMany({
      where: { pipelineId },
      orderBy: { stepOrder: 'asc' },
    });

    for (let i = 0; i < remainingSteps.length; i++) {
      await this.prismaService.thresholdStep.update({
        where: { id: remainingSteps[i].id },
        data: { stepOrder: i + 1 },
      });
    }

    await this.thresholdService.recalculateThresholds(pipelineId);
    await this.updateStats(pipelineId);

    return this.getPipeline(pipelineId) as Promise<ValidationPipeline>;
  }

  async getThresholdSteps(pipelineId: string): Promise<ThresholdStep[]> {
    return this.prismaService.thresholdStep.findMany({
      where: { pipelineId },
      orderBy: { stepOrder: 'asc' },
    });
  }

  async completeThresholdStep(pipelineId: string): Promise<ValidationPipeline> {
    const pipeline = await this.requirePipeline(pipelineId);
    this.requireStatus(pipeline, ValidationPipelineStatus.STEP_THRESHOLD);

    // Activate any remaining PENDING candidates (e.g., if no filters were applied)
    await this.prismaService.validationCandidate.updateMany({
      where: {
        pipelineId,
        status: ValidationCandidateStatus.PENDING,
      },
      data: {
        status: ValidationCandidateStatus.ACTIVE,
        thresholdPassed: true,
      },
    });

    // Delete eliminated candidates — only active/passed candidates proceed
    await this.prismaService.validationCandidate.deleteMany({
      where: {
        pipelineId,
        status: ValidationCandidateStatus.THRESHOLD_ELIMINATED,
      },
    });

    await this.updateStats(pipelineId);

    return this.prismaService.validationPipeline.update({
      where: { id: pipelineId },
      data: {
        status: ValidationPipelineStatus.STEP_PARETO,
        currentStep: 3,
      },
    });
  }

  // ==================== STEP 3: PARETO ====================

  async previewParetoStep(
    pipelineId: string,
    metrics: string[],
  ): Promise<ParetoPreviewResult> {
    await this.requirePipeline(pipelineId);
    return this.paretoService.previewParetoSelection(pipelineId, metrics);
  }

  async applyParetoStep(
    pipelineId: string,
    metrics: string[],
  ): Promise<ValidationPipeline> {
    const pipeline = await this.requirePipeline(pipelineId);
    this.requireStatus(pipeline, ValidationPipelineStatus.STEP_PARETO);

    const result = await this.paretoService.applySingleParetoRun(
      pipelineId,
      metrics,
    );

    const existingSteps = await this.prismaService.paretoStep.count({
      where: { pipelineId },
    });

    await this.prismaService.paretoStep.create({
      data: {
        pipelineId,
        stepOrder: existingSteps + 1,
        metrics,
        optimalCandidateIds: result.optimalIds,
        candidatesBefore: result.candidatesBefore,
        candidatesAfter: result.candidatesAfter,
      },
    });

    // Recompute intersection of all steps to set final candidate statuses
    await this.paretoService.recalculateFromSteps(pipelineId);
    await this.updateStats(pipelineId);

    return this.getPipeline(pipelineId) as Promise<ValidationPipeline>;
  }

  async removeParetoStep(
    pipelineId: string,
    stepId: string,
  ): Promise<ValidationPipeline> {
    const pipeline = await this.requirePipeline(pipelineId);
    this.requireStatus(pipeline, ValidationPipelineStatus.STEP_PARETO);

    await this.prismaService.paretoStep.delete({
      where: { id: stepId },
    });

    // Reorder remaining steps
    const remainingSteps = await this.prismaService.paretoStep.findMany({
      where: { pipelineId },
      orderBy: { stepOrder: 'asc' },
    });

    for (let i = 0; i < remainingSteps.length; i++) {
      await this.prismaService.paretoStep.update({
        where: { id: remainingSteps[i].id },
        data: { stepOrder: i + 1 },
      });
    }

    await this.paretoService.recalculateFromSteps(pipelineId);
    await this.updateStats(pipelineId);

    return this.getPipeline(pipelineId) as Promise<ValidationPipeline>;
  }

  async getParetoSteps(pipelineId: string): Promise<ParetoStep[]> {
    return this.prismaService.paretoStep.findMany({
      where: { pipelineId },
      orderBy: { stepOrder: 'asc' },
    });
  }

  async completeParetoStep(pipelineId: string): Promise<ValidationPipeline> {
    const pipeline = await this.requirePipeline(pipelineId);
    this.requireStatus(pipeline, ValidationPipelineStatus.STEP_PARETO);

    // Delete dominated candidates — only pareto-optimal candidates proceed
    await this.prismaService.validationCandidate.deleteMany({
      where: {
        pipelineId,
        status: ValidationCandidateStatus.PARETO_DOMINATED,
      },
    });

    await this.updateStats(pipelineId);

    return this.prismaService.validationPipeline.update({
      where: { id: pipelineId },
      data: {
        status: ValidationPipelineStatus.STEP_WFA,
        currentStep: 4,
      },
    });
  }

  // ==================== STEP 4: WFA ====================

  async startWfa(
    pipelineId: string,
    trainRatio: number,
    windows: number,
    minConsistency: number,
  ): Promise<ValidationPipeline> {
    const pipeline = await this.requirePipeline(pipelineId);
    this.requireStatus(pipeline, ValidationPipelineStatus.STEP_WFA);

    const existingConfig = pipeline.wfaConfig as unknown as WfaConfigWithState | null;

    if (existingConfig?.status === 'RUNNING') {
      throw new BadRequestException('WFA is already running for this pipeline');
    }

    const config = { trainRatio, windows, minConsistency };

    // Determine resume vs restart
    const configMatches = existingConfig
      && existingConfig.trainRatio === trainRatio
      && existingConfig.windows === windows
      && existingConfig.minConsistency === minConsistency;

    const isResume = !!configMatches
      && (existingConfig.status === 'PAUSED' || existingConfig.status === 'DONE');

    if (!isResume) {
      // Clear previous WFA results from all candidates
      await this.prismaService.validationCandidate.updateMany({
        where: {
          pipelineId,
          status: {
            in: [
              ValidationCandidateStatus.PARETO_OPTIMAL,
              ValidationCandidateStatus.WFA_PASSED,
              ValidationCandidateStatus.WFA_FAILED,
            ],
          },
        },
        data: {
          status: ValidationCandidateStatus.PARETO_OPTIMAL,
          wfaWindowResults: [],
          wfaConsistency: null,
          wfaPassed: null,
        },
      });
    }

    // Count remaining unprocessed candidates
    const remainingCandidates = await this.prismaService.validationCandidate.count({
      where: {
        pipelineId,
        status: ValidationCandidateStatus.PARETO_OPTIMAL,
      },
    });

    // Count already-processed candidates on resume
    const processedCandidates = isResume
      ? await this.prismaService.validationCandidate.count({
          where: {
            pipelineId,
            status: {
              in: [ValidationCandidateStatus.WFA_PASSED, ValidationCandidateStatus.WFA_FAILED],
            },
          },
        })
      : 0;

    const totalCandidates = remainingCandidates + processedCandidates;

    // Save config with RUNNING status
    const wfaConfigState: WfaConfigWithState = {
      ...config,
      status: 'RUNNING',
      processedCandidates,
      totalCandidates,
    };

    const updatedPipeline = await this.prismaService.validationPipeline.update({
      where: { id: pipelineId },
      data: { wfaConfig: wfaConfigState as object },
    });

    await firstValueFrom(
      this.redisClient.emit(PATTERNS.Validation.PipelineUpdated, updatedPipeline),
    );

    // Fire-and-forget: kick off first tick
    this.wfaService
      .processNextCandidate(pipelineId)
      .catch(async (error) => {
        await this.logger.log({
          severity: 'Error',
          summary: `WFA failed for pipeline ${pipelineId}`,
          details: getReadableError(error),
        });

        const errorConfig: WfaConfigWithState = {
          ...config,
          status: 'PAUSED',
          processedCandidates: wfaConfigState.processedCandidates,
          totalCandidates,
        };
        const errorPipeline = await this.prismaService.validationPipeline.update({
          where: { id: pipelineId },
          data: { wfaConfig: errorConfig as object },
        });
        await firstValueFrom(
          this.redisClient.emit(PATTERNS.Validation.PipelineUpdated, errorPipeline),
        );
      });

    return updatedPipeline;
  }

  async pauseWfa(pipelineId: string): Promise<ValidationPipeline> {
    const pipeline = await this.requirePipeline(pipelineId);
    this.requireStatus(pipeline, ValidationPipelineStatus.STEP_WFA);

    const wfaConfig = pipeline.wfaConfig as unknown as WfaConfigWithState | null;

    if (!wfaConfig || wfaConfig.status !== 'RUNNING') {
      throw new BadRequestException('WFA is not running for this pipeline');
    }

    // Set status to PAUSED in DB — next tick will see it and stop
    const pausedConfig: WfaConfigWithState = {
      ...wfaConfig,
      status: 'PAUSED',
    };

    const updatedPipeline = await this.prismaService.validationPipeline.update({
      where: { id: pipelineId },
      data: { wfaConfig: pausedConfig as object },
    });

    await firstValueFrom(
      this.redisClient.emit(PATTERNS.Validation.PipelineUpdated, updatedPipeline),
    );

    return updatedPipeline;
  }

  async resumeWfa(pipelineId: string): Promise<ValidationPipeline> {
    const pipeline = await this.requirePipeline(pipelineId);
    this.requireStatus(pipeline, ValidationPipelineStatus.STEP_WFA);

    const wfaConfig = pipeline.wfaConfig as unknown as WfaConfigWithState | null;

    if (!wfaConfig || wfaConfig.status !== 'PAUSED') {
      throw new BadRequestException('WFA is not paused for this pipeline');
    }

    // Set status back to RUNNING
    const runningConfig: WfaConfigWithState = {
      ...wfaConfig,
      status: 'RUNNING',
    };

    const updatedPipeline = await this.prismaService.validationPipeline.update({
      where: { id: pipelineId },
      data: { wfaConfig: runningConfig as object },
    });

    await firstValueFrom(
      this.redisClient.emit(PATTERNS.Validation.PipelineUpdated, updatedPipeline),
    );

    // Kick off tick processing again
    this.wfaService
      .processNextCandidate(pipelineId)
      .catch(async (error) => {
        await this.logger.log({
          severity: 'Error',
          summary: `WFA resume failed for pipeline ${pipelineId}`,
          details: getReadableError(error),
        });

        const errorConfig: WfaConfigWithState = {
          ...wfaConfig,
          status: 'PAUSED',
        };
        const errorPipeline = await this.prismaService.validationPipeline.update({
          where: { id: pipelineId },
          data: { wfaConfig: errorConfig as object },
        });
        await firstValueFrom(
          this.redisClient.emit(PATTERNS.Validation.PipelineUpdated, errorPipeline),
        );
      });

    return updatedPipeline;
  }

  async completeWfa(pipelineId: string): Promise<ValidationPipeline> {
    const pipeline = await this.requirePipeline(pipelineId);
    this.requireStatus(pipeline, ValidationPipelineStatus.STEP_WFA);

    const wfaConfig = pipeline.wfaConfig as unknown as WfaConfigWithState | null;

    if (!wfaConfig || !['DONE', 'PAUSED'].includes(wfaConfig.status)) {
      throw new BadRequestException(
        'WFA must be completed or paused before approving',
      );
    }

    // Delete failed candidates — only WFA-passed candidates proceed
    await this.prismaService.validationCandidate.deleteMany({
      where: {
        pipelineId,
        status: ValidationCandidateStatus.WFA_FAILED,
      },
    });

    await this.updateStats(pipelineId);

    const updatedPipeline = await this.prismaService.validationPipeline.update({
      where: { id: pipelineId },
      data: {
        status: ValidationPipelineStatus.STEP_USER_SELECTION,
        currentStep: 5,
      },
    });

    await firstValueFrom(
      this.redisClient.emit(PATTERNS.Validation.PipelineUpdated, updatedPipeline),
    );

    return updatedPipeline;
  }

  // ==================== STEP 5: USER SELECTION ====================

  async submitUserSelection(
    pipelineId: string,
    input: UserSelectionInput,
  ): Promise<ValidationPipeline> {
    const pipeline = await this.requirePipeline(pipelineId);
    this.requireStatus(pipeline, ValidationPipelineStatus.STEP_USER_SELECTION);

    const now = new Date();

    await this.prismaService.$transaction([
      this.prismaService.validationCandidate.updateMany({
        where: {
          pipelineId,
          id: { in: input.selectedCandidateIds },
          status: ValidationCandidateStatus.WFA_PASSED,
        },
        data: {
          status: ValidationCandidateStatus.USER_SELECTED,
          userSelectedAt: now,
          userNotes: input.notes,
        },
      }),
      this.prismaService.validationCandidate.updateMany({
        where: {
          pipelineId,
          id: { notIn: input.selectedCandidateIds },
          status: ValidationCandidateStatus.WFA_PASSED,
        },
        data: {
          status: ValidationCandidateStatus.USER_REJECTED,
        },
      }),
    ]);

    await this.updateStats(pipelineId);

    return this.prismaService.validationPipeline.update({
      where: { id: pipelineId },
      data: {
        status: ValidationPipelineStatus.STEP_ROBUSTNESS,
        currentStep: 6,
      },
    });
  }

  // ==================== STEP 6: ROBUSTNESS ====================

  async configureRobustness(
    pipelineId: string,
    config: { steps: number; minScore: number },
  ): Promise<ValidationPipeline> {
    const pipeline = await this.requirePipeline(pipelineId);
    this.requireStatus(pipeline, ValidationPipelineStatus.STEP_ROBUSTNESS);

    return this.prismaService.validationPipeline.update({
      where: { id: pipelineId },
      data: {
        robustnessConfig: config,
        robustnessCompletedSteps: 0,
      },
    });
  }

  async runRobustnessStep(pipelineId: string, stepIndex: number) {
    const pipeline = await this.requirePipeline(pipelineId);
    this.requireStatus(pipeline, ValidationPipelineStatus.STEP_ROBUSTNESS);

    const robustnessConfig = pipeline.robustnessConfig as {
      steps: number;
      minScore: number;
    } | null;

    if (!robustnessConfig) {
      throw new BadRequestException(
        'Robustness not configured. Call configureRobustness first.',
      );
    }

    if (stepIndex >= robustnessConfig.steps) {
      throw new BadRequestException(
        `Step index ${stepIndex} exceeds configured steps (${robustnessConfig.steps})`,
      );
    }

    const results = await this.robustnessService.runSingleStep(
      pipelineId,
      stepIndex,
      robustnessConfig,
    );

    await this.prismaService.validationPipeline.update({
      where: { id: pipelineId },
      data: { robustnessCompletedSteps: stepIndex + 1 },
    });

    return results;
  }

  async completeRobustness(pipelineId: string): Promise<ValidationPipeline> {
    const pipeline = await this.requirePipeline(pipelineId);
    this.requireStatus(pipeline, ValidationPipelineStatus.STEP_ROBUSTNESS);

    const robustnessConfig = pipeline.robustnessConfig as {
      steps: number;
      minScore: number;
    } | null;

    if (!robustnessConfig) {
      throw new BadRequestException('Robustness not configured');
    }

    await this.robustnessService.aggregateAllCandidates(
      pipelineId,
      robustnessConfig.minScore,
    );
    await this.updateStats(pipelineId);

    return this.prismaService.validationPipeline.update({
      where: { id: pipelineId },
      data: {
        status: ValidationPipelineStatus.STEP_FINAL_APPROVAL,
        currentStep: 7,
      },
    });
  }

  // ==================== STEP 7: FINAL APPROVAL ====================

  async submitFinalApproval(
    pipelineId: string,
    input: FinalApprovalInput,
  ): Promise<ValidationPipeline> {
    const pipeline = await this.requirePipeline(pipelineId);
    this.requireStatus(pipeline, ValidationPipelineStatus.STEP_FINAL_APPROVAL);

    const now = new Date();

    await this.prismaService.$transaction([
      this.prismaService.validationCandidate.updateMany({
        where: {
          pipelineId,
          id: { in: input.approvedCandidateIds },
          status: ValidationCandidateStatus.ROBUSTNESS_PASSED,
        },
        data: {
          status: ValidationCandidateStatus.FINAL_APPROVED,
          finalApprovedAt: now,
          finalNotes: input.notes,
        },
      }),
      this.prismaService.validationCandidate.updateMany({
        where: {
          pipelineId,
          id: { notIn: input.approvedCandidateIds },
          status: ValidationCandidateStatus.ROBUSTNESS_PASSED,
        },
        data: {
          status: ValidationCandidateStatus.FINAL_REJECTED,
        },
      }),
    ]);

    await this.updateStats(pipelineId);
    return this.updateStatus(pipelineId, ValidationPipelineStatus.COMPLETED);
  }

  // ==================== HELPERS ====================

  private async requirePipeline(id: string) {
    const pipeline = await this.prismaService.validationPipeline.findUnique({
      where: { id },
    });

    if (!pipeline) {
      throw new NotFoundException(`Pipeline ${id} not found`);
    }

    return pipeline;
  }

  private requireStatus(
    pipeline: { status: ValidationPipelineStatus },
    expected: ValidationPipelineStatus,
  ) {
    if (pipeline.status !== expected) {
      throw new BadRequestException(
        `Pipeline must be in ${expected} status. Current: ${pipeline.status}`,
      );
    }
  }
}
