import { Resolver, Query, Mutation, Args, Int, ID } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { StrategyCategory } from 'generated/prisma/client';

import { StrategyTemplateService } from './strategy-template.service';
import { StrategyTemplate, StrategyTemplateWithStats } from './entities';
import {
  CreateStrategyTemplateInput,
  UpdateStrategyTemplateInput,
} from './dto';

import { GqlAuthGuard } from 'src/microservices/apiService/modules/auth/gql-auth.guard';
import { RolesGuard } from 'src/microservices/apiService/modules/auth/gql-role.guard';
import { Roles } from 'src/microservices/apiService/modules/auth/roles.decorator';
import { UserPermission } from 'generated/prisma/client';

@Resolver()
export class StrategyTemplateResolver {
  constructor(
    private readonly strategyTemplateService: StrategyTemplateService,
  ) {}

  // ==================== QUERIES ====================

  @Query(() => StrategyTemplate, {
    nullable: true,
    description: 'Get a strategy template by ID',
  })
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  async strategyTemplate(
    @Args('id', { type: () => ID }) id: string,
  ): Promise<StrategyTemplate | null> {
    return this.strategyTemplateService.getTemplate(id);
  }

  @Query(() => StrategyTemplate, {
    nullable: true,
    description: 'Get a strategy template by name',
  })
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  async strategyTemplateByName(
    @Args('name') name: string,
  ): Promise<StrategyTemplate | null> {
    return this.strategyTemplateService.getTemplateByName(name);
  }

  @Query(() => [StrategyTemplate], {
    description: 'List strategy templates with optional filtering',
  })
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  async strategyTemplates(
    @Args('category', { type: () => StrategyCategory, nullable: true })
    category?: StrategyCategory,
    @Args('isActive', { type: () => Boolean, nullable: true })
    isActive?: boolean,
    @Args('limit', { type: () => Int, defaultValue: 20 }) limit?: number,
    @Args('offset', { type: () => Int, defaultValue: 0 }) offset?: number,
  ): Promise<StrategyTemplate[]> {
    return this.strategyTemplateService.getTemplates({
      category,
      isActive,
      limit,
      offset,
    });
  }

  @Query(() => StrategyTemplateWithStats, {
    nullable: true,
    description: 'Get a strategy template with usage statistics',
  })
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  async strategyTemplateWithStats(
    @Args('id', { type: () => ID }) id: string,
  ): Promise<StrategyTemplateWithStats | null> {
    return this.strategyTemplateService.getTemplateWithStats(id);
  }

  // ==================== MUTATIONS ====================

  @Mutation(() => StrategyTemplate, {
    description: 'Create a new strategy template',
  })
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  async createStrategyTemplate(
    @Args('input') input: CreateStrategyTemplateInput,
  ): Promise<StrategyTemplate> {
    return this.strategyTemplateService.createTemplate(input);
  }

  @Mutation(() => StrategyTemplate, {
    description: 'Update an existing strategy template',
  })
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  async updateStrategyTemplate(
    @Args('input') input: UpdateStrategyTemplateInput,
  ): Promise<StrategyTemplate> {
    return this.strategyTemplateService.updateTemplate(input);
  }

  @Mutation(() => Boolean, {
    description: 'Delete a strategy template',
  })
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  async deleteStrategyTemplate(
    @Args('id', { type: () => ID }) id: string,
  ): Promise<boolean> {
    return this.strategyTemplateService.deleteTemplate(id);
  }
}
