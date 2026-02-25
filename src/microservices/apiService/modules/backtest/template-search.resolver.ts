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

import { TemplateSearchService } from './template-search.service';
import {
  TemplateSearch,
  TemplateSearchWithTemplate,
  TemplateSearchWithTask,
  TemplateSearchStats,
  BacktestTask,
} from './entities';
import { CreateTemplateSearchInput, TemplateSearchFilterInput } from './dto';

import { PUB_SUB } from 'src/global/global.module';
import { SUBSCRIPTION_TOKEN } from 'src/utils/constants';
import { GqlAuthGuard } from 'src/microservices/apiService/modules/auth/gql-auth.guard';
import { RolesGuard } from 'src/microservices/apiService/modules/auth/gql-role.guard';
import { Roles } from 'src/microservices/apiService/modules/auth/roles.decorator';
import { UserPermission } from 'generated/prisma/client';

@Resolver()
export class TemplateSearchResolver {
  constructor(
    private readonly templateSearchService: TemplateSearchService,
    @Inject(PUB_SUB) private readonly pubSub: PubSub,
  ) {}

  // ==================== QUERIES ====================

  @Query(() => TemplateSearch, {
    nullable: true,
    description: 'Get a template search by ID',
  })
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  async templateSearch(
    @Args('id', { type: () => ID }) id: string,
  ): Promise<TemplateSearch | null> {
    return this.templateSearchService.getSearch(id);
  }

  @Query(() => TemplateSearchWithTask, {
    nullable: true,
    description: 'Get a template search with template and task',
  })
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  async templateSearchWithTask(
    @Args('id', { type: () => ID }) id: string,
  ): Promise<TemplateSearchWithTask | null> {
    return this.templateSearchService.getSearchWithTask(id);
  }

  @Query(() => [TemplateSearchWithTemplate], {
    description: 'List template searches with optional filtering',
  })
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  async templateSearches(
    @Args('filter', { nullable: true }) filter?: TemplateSearchFilterInput,
  ): Promise<TemplateSearchWithTemplate[]> {
    return this.templateSearchService.getSearches(filter);
  }

  @Query(() => TemplateSearchStats, {
    description: 'Get template search count statistics by status',
  })
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  async templateSearchStats(): Promise<TemplateSearchStats> {
    return this.templateSearchService.getSearchStats();
  }

  @Query(() => BacktestTask, {
    nullable: true,
    description: 'Get the task for a specific template search',
  })
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  async taskByTemplateSearch(
    @Args('searchId', { type: () => ID }) searchId: string,
  ): Promise<BacktestTask | null> {
    return this.templateSearchService.getTaskBySearch(searchId);
  }

  @Query(() => [BacktestTask], {
    description: 'Get all tasks using a specific template',
  })
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  async tasksByTemplate(
    @Args('templateId', { type: () => ID }) templateId: string,
  ): Promise<BacktestTask[]> {
    return this.templateSearchService.getTasksByTemplate(templateId);
  }

  // ==================== MUTATIONS ====================

  @Mutation(() => TemplateSearchWithTemplate, {
    description: 'Create a new template search (spawns a BacktestTask)',
  })
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  async createTemplateSearch(
    @Args('input') input: CreateTemplateSearchInput,
  ): Promise<TemplateSearchWithTemplate> {
    return this.templateSearchService.createSearch(input);
  }

  @Mutation(() => TemplateSearch, {
    description: 'Cancel a template search and its task',
  })
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  async cancelTemplateSearch(
    @Args('id', { type: () => ID }) id: string,
  ): Promise<TemplateSearch> {
    return this.templateSearchService.cancelSearch(id);
  }

  @Mutation(() => Boolean, {
    description: 'Delete a template search and its task',
  })
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  async deleteTemplateSearch(
    @Args('id', { type: () => ID }) id: string,
  ): Promise<boolean> {
    return this.templateSearchService.deleteSearch(id);
  }

  // ==================== SUBSCRIPTIONS ====================

  @Subscription(() => TemplateSearch, {
    name: SUBSCRIPTION_TOKEN.templateSearchUpdated,
    description: 'Subscribe to template search status updates',
  })
  subscribeToTemplateSearchUpdated() {
    return this.pubSub.asyncIterableIterator(
      SUBSCRIPTION_TOKEN.templateSearchUpdated,
    );
  }
}
