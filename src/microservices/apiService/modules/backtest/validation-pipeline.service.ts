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
import { PATTERNS, SERVICE_NAMES } from 'src/utils/constants';

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
  ValidationCandidateWithDetails,
} from './entities';

@Injectable()
export class ValidationPipelineService {
  constructor(
    @Inject(SERVICE_NAMES.REDIS_SERVICE) private redisClient: ClientProxy,
    private readonly prismaService: PrismaService,
  ) {}

  /**
   * Create a new validation pipeline from a completed template search
   */
  async createPipeline(
    input: CreateValidationPipelineInput,
  ): Promise<ValidationPipeline> {
    // Fetch TemplateSearch and verify it's completed
    const search = await this.prismaService.templateSearch.findUnique({
      where: { id: input.templateSearchId },
      include: {
        task: {
          include: {
            results: true,
          },
        },
      },
    });

    if (!search) {
      throw new NotFoundException(
        `TemplateSearch ${input.templateSearchId} not found`,
      );
    }

    if (!search.task || search.task.results.length === 0) {
      throw new BadRequestException(
        'TemplateSearch has no backtest results to validate',
      );
    }

    // Use transaction to ensure pipeline and candidates are created atomically
    const pipeline = await this.prismaService.$transaction(async (tx) => {
      // Create the pipeline
      const newPipeline = await tx.validationPipeline.create({
        data: {
          name: input.name,
          templateSearchId: input.templateSearchId,
          status: ValidationPipelineStatus.CREATED,
          thresholdConfig: input.thresholdConfig as object,
          paretoMetrics: input.paretoMetrics || [
            'sharpeRatio',
            'totalPnlPercent',
            'maxDrawdownPercent',
          ],
          wfaTrainRatio: input.wfaTrainRatio ?? 0.7,
          wfaWindows: input.wfaWindows ?? 3,
          wfaMinConsistency: input.wfaMinConsistency ?? 0.6,
          robustnessSteps: input.robustnessSteps ?? 10,
          robustnessMinScore: input.robustnessMinScore ?? 0.7,
          totalCandidates: search.task?.results.length ?? 0,
        },
      });

      // Create ValidationCandidate for each result
      const candidateData = search.task?.results.map((result) => ({
        pipelineId: newPipeline.id,
        resultId: result.id,
        configId: result.configId,
        status: ValidationCandidateStatus.PENDING,
      }));

      await tx.validationCandidate.createMany({
        data: candidateData || [],
      });

      return newPipeline;
    });

    await firstValueFrom(
      this.redisClient.emit(PATTERNS.Validation.PipelineCreated, pipeline),
    );

    return pipeline;
  }

  /**
   * Get a pipeline by ID
   */
  async getPipeline(id: string): Promise<ValidationPipeline | null> {
    return this.prismaService.validationPipeline.findUnique({
      where: { id },
    });
  }

  /**
   * Get a pipeline with candidates
   */
  async getPipelineWithCandidates(
    id: string,
  ): Promise<ValidationPipelineWithCandidates | null> {
    return this.prismaService.validationPipeline.findUnique({
      where: { id },
      include: {
        candidates: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });
  }

  /**
   * Get pipelines with optional filtering
   */
  async getPipelines(
    filter?: ValidationPipelineFilterInput,
  ): Promise<ValidationPipeline[]> {
    return this.prismaService.validationPipeline.findMany({
      where: {
        ...(filter?.status && { status: filter.status }),
        ...(filter?.templateSearchId && {
          templateSearchId: filter.templateSearchId,
        }),
      },
      orderBy: { createdAt: 'desc' },
      take: filter?.limit || 20,
      skip: filter?.offset || 0,
    });
  }

  /**
   * Get pipeline statistics
   */
  async getPipelineStats(): Promise<ValidationPipelineStats> {
    const [created, running, awaitingUser, completed, failed, cancelled] =
      await Promise.all([
        this.prismaService.validationPipeline.count({
          where: { status: ValidationPipelineStatus.CREATED },
        }),
        this.prismaService.validationPipeline.count({
          where: {
            status: {
              in: [
                ValidationPipelineStatus.LAYER_1_RUNNING,
                ValidationPipelineStatus.LAYER_2_RUNNING,
                ValidationPipelineStatus.LAYER_3_RUNNING,
                ValidationPipelineStatus.LAYER_5_RUNNING,
              ],
            },
          },
        }),
        this.prismaService.validationPipeline.count({
          where: {
            status: {
              in: [
                ValidationPipelineStatus.AWAITING_USER_SELECTION,
                ValidationPipelineStatus.AWAITING_FINAL_APPROVAL,
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

    return { created, running, awaitingUser, completed, failed, cancelled };
  }

  /**
   * Update pipeline status
   */
  async updateStatus(
    id: string,
    status: ValidationPipelineStatus,
    errorMessage?: string,
  ): Promise<ValidationPipeline> {
    const updateData: Record<string, unknown> = { status };

    if (status === ValidationPipelineStatus.LAYER_1_RUNNING) {
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

  /**
   * Update pipeline stats from candidates
   */
  async updateStats(id: string): Promise<ValidationPipeline> {
    const stats = await this.prismaService.validationCandidate.groupBy({
      by: ['status'],
      where: { pipelineId: id },
      _count: true,
    });

    const statMap = new Map(stats.map((s) => [s.status, s._count]));

    const pipeline = await this.prismaService.validationPipeline.update({
      where: { id },
      data: {
        passedThreshold:
          (statMap.get(ValidationCandidateStatus.PASSED_THRESHOLD) || 0) +
          (statMap.get(ValidationCandidateStatus.PARETO_OPTIMAL) || 0) +
          (statMap.get(ValidationCandidateStatus.PARETO_DOMINATED) || 0) +
          (statMap.get(ValidationCandidateStatus.WFA_PENDING) || 0) +
          (statMap.get(ValidationCandidateStatus.WFA_PASSED) || 0) +
          (statMap.get(ValidationCandidateStatus.WFA_FAILED) || 0) +
          (statMap.get(ValidationCandidateStatus.USER_SELECTED) || 0) +
          (statMap.get(ValidationCandidateStatus.USER_REJECTED) || 0) +
          (statMap.get(ValidationCandidateStatus.ROBUSTNESS_PENDING) || 0) +
          (statMap.get(ValidationCandidateStatus.ROBUSTNESS_PASSED) || 0) +
          (statMap.get(ValidationCandidateStatus.ROBUSTNESS_FAILED) || 0) +
          (statMap.get(ValidationCandidateStatus.FINAL_APPROVED) || 0) +
          (statMap.get(ValidationCandidateStatus.FINAL_REJECTED) || 0),
        paretoOptimal:
          (statMap.get(ValidationCandidateStatus.PARETO_OPTIMAL) || 0) +
          (statMap.get(ValidationCandidateStatus.WFA_PENDING) || 0) +
          (statMap.get(ValidationCandidateStatus.WFA_PASSED) || 0) +
          (statMap.get(ValidationCandidateStatus.WFA_FAILED) || 0) +
          (statMap.get(ValidationCandidateStatus.USER_SELECTED) || 0) +
          (statMap.get(ValidationCandidateStatus.USER_REJECTED) || 0) +
          (statMap.get(ValidationCandidateStatus.ROBUSTNESS_PENDING) || 0) +
          (statMap.get(ValidationCandidateStatus.ROBUSTNESS_PASSED) || 0) +
          (statMap.get(ValidationCandidateStatus.ROBUSTNESS_FAILED) || 0) +
          (statMap.get(ValidationCandidateStatus.FINAL_APPROVED) || 0) +
          (statMap.get(ValidationCandidateStatus.FINAL_REJECTED) || 0),
        passedWfa:
          (statMap.get(ValidationCandidateStatus.WFA_PASSED) || 0) +
          (statMap.get(ValidationCandidateStatus.USER_SELECTED) || 0) +
          (statMap.get(ValidationCandidateStatus.USER_REJECTED) || 0) +
          (statMap.get(ValidationCandidateStatus.ROBUSTNESS_PENDING) || 0) +
          (statMap.get(ValidationCandidateStatus.ROBUSTNESS_PASSED) || 0) +
          (statMap.get(ValidationCandidateStatus.ROBUSTNESS_FAILED) || 0) +
          (statMap.get(ValidationCandidateStatus.FINAL_APPROVED) || 0) +
          (statMap.get(ValidationCandidateStatus.FINAL_REJECTED) || 0),
        userSelected:
          (statMap.get(ValidationCandidateStatus.USER_SELECTED) || 0) +
          (statMap.get(ValidationCandidateStatus.ROBUSTNESS_PENDING) || 0) +
          (statMap.get(ValidationCandidateStatus.ROBUSTNESS_PASSED) || 0) +
          (statMap.get(ValidationCandidateStatus.ROBUSTNESS_FAILED) || 0) +
          (statMap.get(ValidationCandidateStatus.FINAL_APPROVED) || 0) +
          (statMap.get(ValidationCandidateStatus.FINAL_REJECTED) || 0),
        passedRobustness:
          (statMap.get(ValidationCandidateStatus.ROBUSTNESS_PASSED) || 0) +
          (statMap.get(ValidationCandidateStatus.FINAL_APPROVED) || 0) +
          (statMap.get(ValidationCandidateStatus.FINAL_REJECTED) || 0),
        finalApproved:
          statMap.get(ValidationCandidateStatus.FINAL_APPROVED) || 0,
      },
    });

    await firstValueFrom(
      this.redisClient.emit(PATTERNS.Validation.PipelineUpdated, pipeline),
    );

    return pipeline;
  }

  /**
   * Start the validation pipeline (trigger Layer 1)
   */
  async startPipeline(id: string): Promise<ValidationPipeline> {
    const pipeline = await this.prismaService.validationPipeline.findUnique({
      where: { id },
    });

    if (!pipeline) {
      throw new NotFoundException(`Pipeline ${id} not found`);
    }

    if (pipeline.status !== ValidationPipelineStatus.CREATED) {
      throw new BadRequestException(
        `Pipeline must be in CREATED status to start. Current status: ${pipeline.status}`,
      );
    }

    // Status will be updated to LAYER_1_RUNNING by the runner
    return pipeline;
  }

  /**
   * Submit user selection (Layer 4)
   * Uses transaction to ensure atomic updates of selected/rejected candidates
   */
  async submitUserSelection(
    pipelineId: string,
    input: UserSelectionInput,
  ): Promise<ValidationPipeline> {
    const pipeline = await this.prismaService.validationPipeline.findUnique({
      where: { id: pipelineId },
    });

    if (!pipeline) {
      throw new NotFoundException(`Pipeline ${pipelineId} not found`);
    }

    if (pipeline.status !== ValidationPipelineStatus.AWAITING_USER_SELECTION) {
      throw new BadRequestException(
        `Pipeline must be in AWAITING_USER_SELECTION status. Current status: ${pipeline.status}`,
      );
    }

    const now = new Date();

    // Use transaction to ensure atomic updates
    await this.prismaService.$transaction([
      // Mark selected candidates
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
      // Mark non-selected candidates as rejected
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

    // Update stats and move to next layer
    await this.updateStats(pipelineId);

    // Status will be updated to LAYER_5_RUNNING by the runner
    const result = await this.prismaService.validationPipeline.findUnique({
      where: { id: pipelineId },
    });

    if (!result) {
      throw new NotFoundException(
        `Pipeline ${pipelineId} was deleted during user selection`,
      );
    }

    return result;
  }

  /**
   * Submit final approval (Layer 6)
   * Uses transaction to ensure atomic updates of approved/rejected candidates
   */
  async submitFinalApproval(
    pipelineId: string,
    input: FinalApprovalInput,
  ): Promise<ValidationPipeline> {
    const pipeline = await this.prismaService.validationPipeline.findUnique({
      where: { id: pipelineId },
    });

    if (!pipeline) {
      throw new NotFoundException(`Pipeline ${pipelineId} not found`);
    }

    if (pipeline.status !== ValidationPipelineStatus.AWAITING_FINAL_APPROVAL) {
      throw new BadRequestException(
        `Pipeline must be in AWAITING_FINAL_APPROVAL status. Current status: ${pipeline.status}`,
      );
    }

    const now = new Date();

    // Use transaction to ensure atomic updates
    await this.prismaService.$transaction([
      // Mark approved candidates
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
      // Mark non-approved candidates as rejected
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

    // Update stats and mark pipeline as completed
    await this.updateStats(pipelineId);
    return this.updateStatus(pipelineId, ValidationPipelineStatus.COMPLETED);
  }

  /**
   * Cancel a pipeline
   */
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

  /**
   * Delete a pipeline and all related records
   */
  async deletePipeline(id: string): Promise<boolean> {
    const pipeline = await this.prismaService.validationPipeline.findUnique({
      where: { id },
    });

    if (!pipeline) {
      throw new NotFoundException(`Pipeline ${id} not found`);
    }

    // Cascade delete will handle candidates, WFA results, and robustness tests
    await this.prismaService.validationPipeline.delete({
      where: { id },
    });

    return true;
  }

  /**
   * Get candidates by status
   */
  async getCandidatesByStatus(
    filter: ValidationCandidateFilterInput,
  ): Promise<ValidationCandidateWithResult[]> {
    return this.prismaService.validationCandidate.findMany({
      where: {
        pipelineId: filter.pipelineId,
        ...(filter.status && { status: filter.status }),
      },
      include: {
        result: true,
      },
      orderBy: { createdAt: 'asc' },
      take: filter.limit || 100,
      skip: filter.offset || 0,
    });
  }

  /**
   * Get candidate with full details
   */
  async getCandidateWithDetails(
    id: string,
  ): Promise<ValidationCandidateWithDetails | null> {
    return this.prismaService.validationCandidate.findUnique({
      where: { id },
      include: {
        result: true,
        walkForwardResults: {
          orderBy: { windowIndex: 'asc' },
        },
        robustnessTests: {
          orderBy: { stepIndex: 'asc' },
        },
      },
    });
  }
}
