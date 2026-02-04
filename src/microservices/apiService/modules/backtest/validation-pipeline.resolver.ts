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
  ValidationCandidateWithDetails,
} from './entities';
import {
  CreateValidationPipelineInput,
  ValidationPipelineFilterInput,
  ValidationCandidateFilterInput,
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

  @Query(() => ValidationCandidateWithDetails, {
    nullable: true,
    description: 'Get a validation candidate with full details',
  })
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  async validationCandidate(
    @Args('id', { type: () => ID }) id: string,
  ): Promise<ValidationCandidateWithDetails | null> {
    return this.validationPipelineService.getCandidateWithDetails(id);
  }

  @Query(() => [ValidationCandidateWithResult], {
    description: 'Get validation candidates by pipeline and optional status',
  })
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  async validationCandidatesByStatus(
    @Args('filter') filter: ValidationCandidateFilterInput,
  ): Promise<ValidationCandidateWithResult[]> {
    return this.validationPipelineService.getCandidatesByStatus(filter);
  }

  // ==================== MUTATIONS ====================

  @Mutation(() => ValidationPipeline, {
    description:
      'Create a new validation pipeline from a completed template search',
  })
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  async createValidationPipeline(
    @Args('input') input: CreateValidationPipelineInput,
  ): Promise<ValidationPipeline> {
    return this.validationPipelineService.createPipeline(input);
  }

  @Mutation(() => ValidationPipeline, {
    description: 'Start a validation pipeline (triggers Layer 1-3 processing)',
  })
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  async startValidationPipeline(
    @Args('id', { type: () => ID }) id: string,
  ): Promise<ValidationPipeline> {
    return this.validationPipelineService.startPipeline(id);
  }

  @Mutation(() => ValidationPipeline, {
    description:
      'Submit user selection of candidates (Layer 4) to proceed to Layer 5',
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

  @Mutation(() => ValidationPipeline, {
    description:
      'Submit final approval of candidates (Layer 6) to complete pipeline',
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
