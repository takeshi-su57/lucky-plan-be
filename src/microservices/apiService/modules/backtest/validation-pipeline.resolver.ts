import {
  Resolver,
  Query,
  Mutation,
  Args,
  ID,
  Subscription,
} from '@nestjs/graphql';
import { Inject, UseGuards } from '@nestjs/common';
import { PubSub } from 'graphql-subscriptions';

import { ValidationPipelineService } from './validation-pipeline.service';
import {
  ValidationPipeline,
  ValidationPipelineWithCandidates,
  ValidationPipelineStats,
  ValidationCandidate,
  ValidationCandidateWithResult,
  PaginatedValidationCandidatesResult,
  ThresholdStep,
  ThresholdPreviewResult,
  ParetoStep,
  ParetoPreviewResult,
  RobustnessStepResult,
} from './entities';
import {
  CreateValidationPipelineInput,
  ValidationPipelineFilterInput,
  ValidationCandidateFilterInput,
  ApplyThresholdStepInput,
  PreviewThresholdStepInput,
  ApplyParetoStepInput,
  PreviewParetoStepInput,
  StartWfaInput,
  ConfigureRobustnessInput,
  RunRobustnessStepInput,
  UserSelectionInput,
  FinalApprovalInput,
} from './dto';

import { PUB_SUB } from 'src/global/global.module';
import { SUBSCRIPTION_TOKEN } from 'src/utils/constants';
import { GqlAuthGuard } from 'src/microservices/apiService/modules/auth/gql-auth.guard';
import { RolesGuard } from 'src/microservices/apiService/modules/auth/gql-role.guard';
import { Roles } from 'src/microservices/apiService/modules/auth/roles.decorator';
import { UserPermission } from 'generated/prisma/client';

@Resolver()
export class ValidationPipelineResolver {
  constructor(
    private readonly validationPipelineService: ValidationPipelineService,
    @Inject(PUB_SUB) private readonly pubSub: PubSub,
  ) {}

  // ==================== QUERIES ====================

  @Query(() => ValidationPipeline, {
    nullable: true,
    description: 'Get a validation pipeline by ID',
  })
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  async validationPipeline(
    @Args('id', { type: () => ID }) id: string,
  ): Promise<ValidationPipeline | null> {
    return this.validationPipelineService.getPipeline(id);
  }

  @Query(() => ValidationPipelineWithCandidates, {
    nullable: true,
    description: 'Get a validation pipeline with all its candidates',
  })
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  async validationPipelineWithCandidates(
    @Args('id', { type: () => ID }) id: string,
  ): Promise<ValidationPipelineWithCandidates | null> {
    return this.validationPipelineService.getPipelineWithCandidates(id);
  }

  @Query(() => [ValidationPipeline], {
    description: 'List validation pipelines with optional filtering',
  })
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  async validationPipelines(
    @Args('filter', { nullable: true }) filter?: ValidationPipelineFilterInput,
  ): Promise<ValidationPipeline[]> {
    return this.validationPipelineService.getPipelines(filter);
  }

  @Query(() => ValidationPipelineStats, {
    description: 'Get validation pipeline count statistics by status',
  })
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  async validationPipelineStats(): Promise<ValidationPipelineStats> {
    return this.validationPipelineService.getPipelineStats();
  }

  @Query(() => ValidationCandidateWithResult, {
    nullable: true,
    description: 'Get a validation candidate with result details',
  })
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  async validationCandidate(
    @Args('id', { type: () => ID }) id: string,
  ): Promise<ValidationCandidateWithResult | null> {
    return this.validationPipelineService.getCandidateWithDetails(id);
  }

  @Query(() => PaginatedValidationCandidatesResult, {
    description: 'Get validation candidates by pipeline and optional status',
  })
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  async validationCandidatesByStatus(
    @Args('filter') filter: ValidationCandidateFilterInput,
  ): Promise<PaginatedValidationCandidatesResult> {
    return this.validationPipelineService.getCandidatesByStatus(filter);
  }

  @Query(() => [ThresholdStep], {
    description: 'Get all threshold steps for a pipeline',
  })
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  async thresholdSteps(
    @Args('pipelineId', { type: () => ID }) pipelineId: string,
  ): Promise<ThresholdStep[]> {
    return this.validationPipelineService.getThresholdSteps(pipelineId);
  }

  // ==================== MUTATIONS ====================

  @Mutation(() => ValidationPipeline, {
    description: 'Create a new validation pipeline from a completed backtest task',
  })
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  async createValidationPipeline(
    @Args('input') input: CreateValidationPipelineInput,
  ): Promise<ValidationPipeline> {
    return this.validationPipelineService.createPipeline(input);
  }

  // --- Step 2: Threshold ---

  @Mutation(() => ValidationPipeline, {
    description: 'Apply a single threshold filter to pipeline candidates',
  })
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  async applyThresholdStep(
    @Args('input') input: ApplyThresholdStepInput,
  ): Promise<ValidationPipeline> {
    return this.validationPipelineService.applyThresholdStep(
      input.pipelineId,
      input.metricName,
      input.operator,
      input.value,
    );
  }

  @Mutation(() => ThresholdPreviewResult, {
    description: 'Preview a threshold filter without applying it',
  })
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  async previewThresholdStep(
    @Args('input') input: PreviewThresholdStepInput,
  ): Promise<ThresholdPreviewResult> {
    return this.validationPipelineService.previewThresholdStep(
      input.pipelineId,
      input.metricName,
      input.operator,
      input.value,
    );
  }

  @Mutation(() => ValidationPipeline, {
    description: 'Remove a threshold step and recalculate',
  })
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  async removeThresholdStep(
    @Args('pipelineId', { type: () => ID }) pipelineId: string,
    @Args('stepId', { type: () => ID }) stepId: string,
  ): Promise<ValidationPipeline> {
    return this.validationPipelineService.removeThresholdStep(
      pipelineId,
      stepId,
    );
  }

  @Mutation(() => ValidationPipeline, {
    description: 'Complete threshold step and advance to Pareto selection',
  })
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  async completeThresholdStep(
    @Args('pipelineId', { type: () => ID }) pipelineId: string,
  ): Promise<ValidationPipeline> {
    return this.validationPipelineService.completeThresholdStep(pipelineId);
  }

  // --- Step 3: Pareto ---

  @Query(() => [ParetoStep], {
    description: 'Get all Pareto steps for a pipeline',
  })
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  async paretoSteps(
    @Args('pipelineId', { type: () => ID }) pipelineId: string,
  ): Promise<ParetoStep[]> {
    return this.validationPipelineService.getParetoSteps(pipelineId);
  }

  @Mutation(() => ParetoPreviewResult, {
    description: 'Preview Pareto selection without applying it',
  })
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  async previewParetoStep(
    @Args('input') input: PreviewParetoStepInput,
  ): Promise<ParetoPreviewResult> {
    return this.validationPipelineService.previewParetoStep(
      input.pipelineId,
      input.metrics,
    );
  }

  @Mutation(() => ValidationPipeline, {
    description: 'Apply a Pareto selection run with specified metrics',
  })
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  async applyParetoStep(
    @Args('input') input: ApplyParetoStepInput,
  ): Promise<ValidationPipeline> {
    return this.validationPipelineService.applyParetoStep(
      input.pipelineId,
      input.metrics,
    );
  }

  @Mutation(() => ValidationPipeline, {
    description: 'Remove a Pareto step and recalculate',
  })
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  async removeParetoStep(
    @Args('pipelineId', { type: () => ID }) pipelineId: string,
    @Args('stepId', { type: () => ID }) stepId: string,
  ): Promise<ValidationPipeline> {
    return this.validationPipelineService.removeParetoStep(
      pipelineId,
      stepId,
    );
  }

  @Mutation(() => ValidationPipeline, {
    description: 'Complete Pareto step and advance to WFA',
  })
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  async completeParetoStep(
    @Args('pipelineId', { type: () => ID }) pipelineId: string,
  ): Promise<ValidationPipeline> {
    return this.validationPipelineService.completeParetoStep(pipelineId);
  }

  // --- Step 4: Walk-Forward Analysis ---

  @Mutation(() => ValidationPipeline, {
    description: 'Start WFA background process. Returns immediately, progress via subscription.',
  })
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  async startWfa(
    @Args('input') input: StartWfaInput,
  ): Promise<ValidationPipeline> {
    return this.validationPipelineService.startWfa(
      input.pipelineId,
      input.trainRatio,
      input.windows,
      input.minConsistency,
    );
  }

  @Mutation(() => ValidationPipeline, {
    description: 'Pause a running WFA process. Takes effect after current candidate finishes.',
  })
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  async pauseWfa(
    @Args('pipelineId', { type: () => ID }) pipelineId: string,
  ): Promise<ValidationPipeline> {
    return this.validationPipelineService.pauseWfa(pipelineId);
  }

  @Mutation(() => ValidationPipeline, {
    description: 'Resume a paused WFA process. Continues from where it left off.',
  })
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  async resumeWfa(
    @Args('pipelineId', { type: () => ID }) pipelineId: string,
  ): Promise<ValidationPipeline> {
    return this.validationPipelineService.resumeWfa(pipelineId);
  }

  @Mutation(() => ValidationPipeline, {
    description: 'Approve WFA results, remove failed candidates, and advance to user selection',
  })
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  async completeWfa(
    @Args('pipelineId', { type: () => ID }) pipelineId: string,
  ): Promise<ValidationPipeline> {
    return this.validationPipelineService.completeWfa(pipelineId);
  }

  // --- Step 5: User Selection ---

  @Mutation(() => ValidationPipeline, {
    description: 'Submit user selection of candidates and advance to robustness',
  })
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  async submitUserSelection(
    @Args('pipelineId', { type: () => ID }) pipelineId: string,
    @Args('input') input: UserSelectionInput,
  ): Promise<ValidationPipeline> {
    return this.validationPipelineService.submitUserSelection(
      pipelineId,
      input,
    );
  }

  // --- Step 6: Robustness ---

  @Mutation(() => ValidationPipeline, {
    description: 'Configure robustness test parameters before running steps',
  })
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  async configureRobustness(
    @Args('input') input: ConfigureRobustnessInput,
  ): Promise<ValidationPipeline> {
    return this.validationPipelineService.configureRobustness(
      input.pipelineId,
      {
        steps: input.steps,
        minScore: input.minScore,
      },
    );
  }

  @Mutation(() => [RobustnessStepResult], {
    description: 'Run a single robustness step across all selected candidates',
  })
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  async runRobustnessStep(
    @Args('input') input: RunRobustnessStepInput,
  ): Promise<RobustnessStepResult[]> {
    return this.validationPipelineService.runRobustnessStep(
      input.pipelineId,
      input.stepIndex,
    );
  }

  @Mutation(() => ValidationPipeline, {
    description:
      'Complete robustness testing, aggregate results, and advance to final approval',
  })
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  async completeRobustness(
    @Args('pipelineId', { type: () => ID }) pipelineId: string,
  ): Promise<ValidationPipeline> {
    return this.validationPipelineService.completeRobustness(pipelineId);
  }

  // --- Step 7: Final Approval ---

  @Mutation(() => ValidationPipeline, {
    description: 'Submit final approval of candidates to complete the pipeline',
  })
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  async submitFinalApproval(
    @Args('pipelineId', { type: () => ID }) pipelineId: string,
    @Args('input') input: FinalApprovalInput,
  ): Promise<ValidationPipeline> {
    return this.validationPipelineService.submitFinalApproval(
      pipelineId,
      input,
    );
  }

  // --- Pipeline Management ---

  @Mutation(() => ValidationPipeline, {
    description: 'Cancel a validation pipeline',
  })
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  async cancelValidationPipeline(
    @Args('id', { type: () => ID }) id: string,
  ): Promise<ValidationPipeline> {
    return this.validationPipelineService.cancelPipeline(id);
  }

  @Mutation(() => Boolean, {
    description: 'Delete a validation pipeline and all related records',
  })
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  async deleteValidationPipeline(
    @Args('id', { type: () => ID }) id: string,
  ): Promise<boolean> {
    return this.validationPipelineService.deletePipeline(id);
  }

  // ==================== SUBSCRIPTIONS ====================

  @Subscription(() => ValidationPipeline, {
    name: SUBSCRIPTION_TOKEN.validationPipelineUpdated,
    description: 'Subscribe to validation pipeline status updates',
  })
  subscribeToValidationPipelineUpdated() {
    return this.pubSub.asyncIterableIterator(
      SUBSCRIPTION_TOKEN.validationPipelineUpdated,
    );
  }

  @Subscription(() => ValidationCandidate, {
    name: SUBSCRIPTION_TOKEN.validationCandidateUpdated,
    description: 'Subscribe to validation candidate status updates',
  })
  subscribeToValidationCandidateUpdated() {
    return this.pubSub.asyncIterableIterator(
      SUBSCRIPTION_TOKEN.validationCandidateUpdated,
    );
  }
}
