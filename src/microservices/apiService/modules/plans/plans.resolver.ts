import { Inject, UseGuards } from '@nestjs/common';
import {
  Resolver,
  Query,
  Mutation,
  Args,
  Int,
  Subscription,
} from '@nestjs/graphql';
import {
  PlanStatus,
  User,
  UserPermission,
  Platform,
} from 'generated/prisma/client';
import { PubSub } from 'graphql-subscriptions';
import * as dayjs from 'dayjs';

import { PUB_SUB } from 'src/global/global.module';
import { SUBSCRIPTION_TOKEN } from 'src/utils/constants';

import { PlansService } from './plans.service';
import {
  Plan,
  PlanConnection,
  PlanSummaryConnection,
  PlanForwardDetails,
  ExpertPnlSnapshotV2Connection,
  BotGroupPaginatedResponse,
} from './entities/plan.entity';
import { CreatePlanInput, UpdatePlanInput } from './dto/plan.input';
import { GqlAuthGuard } from 'src/microservices/apiService/modules/auth/gql-auth.guard';
import { CurrentUser } from 'src/microservices/apiService/modules/auth/user.decorator';
import { Roles } from 'src/microservices/apiService/modules/auth/roles.decorator';
import { RolesGuard } from 'src/microservices/apiService/modules/auth/gql-role.guard';
import { AutoPlansService } from './autoplans.service';

@Resolver()
export class PlansResolver {
  constructor(
    private readonly plansService: PlansService,
    private readonly autoplanService: AutoPlansService,
    @Inject(PUB_SUB) private readonly pubSub: PubSub,
  ) {}

  @Mutation(() => Plan)
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  createPlan(
    @Args('createPlanInput') createPlanInput: CreatePlanInput,
    @CurrentUser() user: User,
  ) {
    return this.plansService.create(user.address, createPlanInput);
  }

  @Mutation(() => Boolean)
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  createAutoPlan(@CurrentUser() user: User) {
    return this.autoplanService.createAutoPlansForUser(user.address);
  }

  @Mutation(() => Int)
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  deletePlan(
    @Args('id', { type: () => Int }) id: number,
    @CurrentUser() user: User,
  ) {
    return this.plansService.delete(user.address, id);
  }

  @Mutation(() => Plan)
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  updatePlan(
    @Args('updatePlanInput') updatePlanInput: UpdatePlanInput,
    @CurrentUser() user: User,
  ) {
    return this.plansService.update(user.address, updatePlanInput);
  }

  @Mutation(() => Boolean)
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  startPlan(
    @Args('id', { type: () => Int }) id: number,
    @CurrentUser() user: User,
  ) {
    return this.plansService.start(user.address, id);
  }

  @Mutation(() => Boolean)
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  endPlan(
    @Args('id', { type: () => Int }) id: number,
    @CurrentUser() user: User,
  ) {
    return this.plansService.end(user.address, id);
  }

  @Subscription(() => Plan, {
    name: SUBSCRIPTION_TOKEN.planCreated,
    filter: (payload, variables) => {
      return payload.planCreated.userId === variables.userId;
    },
  })
  subscribeToPlanCreated(
    @Args('userId', { type: () => String }) _userId: string,
  ) {
    return this.pubSub.asyncIterableIterator(SUBSCRIPTION_TOKEN.planCreated);
  }

  @Subscription(() => Plan, {
    name: SUBSCRIPTION_TOKEN.planUpdated,
    filter: (payload, variables) => {
      return payload.planUpdated.userId === variables.userId;
    },
  })
  subscribeToPlanUpdated(
    @Args('userId', { type: () => String }) _userId: string,
  ) {
    return this.pubSub.asyncIterableIterator(SUBSCRIPTION_TOKEN.planUpdated);
  }

  @Query(() => PlanConnection)
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  getPlansByStatus(
    @Args('status', { type: () => PlanStatus })
    status: PlanStatus,
    @Args('first', { type: () => Int }) first: number,
    @Args('after', { type: () => Int, nullable: true }) after: number | null,
    @CurrentUser() user: User,
  ) {
    return this.plansService.getPlansByStatus(
      user.address,
      status,
      first,
      after,
    );
  }

  @Query(() => PlanSummaryConnection)
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  getPlanSummariesByStatus(
    @Args('status', { type: () => PlanStatus })
    status: PlanStatus,
    @Args('first', { type: () => Int }) first: number,
    @Args('after', { type: () => Int, nullable: true }) after: number | null,
    @CurrentUser() user: User,
  ) {
    return this.plansService.getPlanSummariesByStatus(
      user.address,
      status,
      first,
      after,
    );
  }

  @Query(() => PlanForwardDetails, { nullable: true })
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  getPlanById(
    @Args('id', { type: () => Int }) id: number,
    @CurrentUser() user: User,
  ) {
    return this.plansService.getPlanById(user.address, id);
  }

  @Query(() => BotGroupPaginatedResponse)
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  getPlanBotGroups(
    @Args('planId', { type: () => Int }) planId: number,
    @Args('page', { type: () => Int, defaultValue: 1 }) page: number,
    @Args('pageSize', { type: () => Int, defaultValue: 10 }) pageSize: number,
    @Args('hideDead', { type: () => Boolean, defaultValue: true })
    hideDead: boolean,
    @CurrentUser() user: User,
  ) {
    return this.plansService.getPlanBotGroups(
      user.address,
      planId,
      page,
      pageSize,
      hideDead,
    );
  }

  @Query(() => ExpertPnlSnapshotV2Connection)
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  getExpertPnlSnapshotsV2(
    @CurrentUser() _user: User,
    @Args('platform', { type: () => Platform }) platform: Platform,
    @Args('after', { type: () => Int, nullable: true }) after: number | null,
  ) {
    return this.autoplanService.filterExperts(
      platform,
      dayjs().format('YYYY-MM-DD'),
      after,
    );
  }

  @Query(() => [String], { nullable: true })
  @Roles(UserPermission.Admin)
  @UseGuards(GqlAuthGuard, RolesGuard)
  getBlacklist(@CurrentUser() _user: User) {
    return this.autoplanService.getBlacklist();
  }

  @Mutation(() => Boolean)
  @Roles(UserPermission.Admin)
  @UseGuards(GqlAuthGuard, RolesGuard)
  addToBlacklist(
    @Args('address', { type: () => String }) address: string,
    @CurrentUser() _user: User,
  ) {
    return this.autoplanService.addToBlacklist(address);
  }

  @Mutation(() => Boolean)
  @Roles(UserPermission.Admin)
  @UseGuards(GqlAuthGuard, RolesGuard)
  removeFromBlacklist(
    @Args('address', { type: () => String }) address: string,
    @CurrentUser() _user: User,
  ) {
    return this.autoplanService.removeFromBlacklist(address);
  }

  @Query(() => [String], { nullable: true })
  @Roles(UserPermission.Admin)
  @UseGuards(GqlAuthGuard, RolesGuard)
  getWhitelist(@CurrentUser() _user: User) {
    return this.autoplanService.getWhitelist();
  }

  @Mutation(() => Boolean)
  @Roles(UserPermission.Admin)
  @UseGuards(GqlAuthGuard, RolesGuard)
  addToWhitelist(
    @Args('params', { type: () => String }) params: string,
    @CurrentUser() _user: User,
  ) {
    return this.autoplanService.addToWhitelist(params);
  }

  @Mutation(() => Boolean)
  @Roles(UserPermission.Admin)
  @UseGuards(GqlAuthGuard, RolesGuard)
  removeFromWhitelist(
    @Args('address', { type: () => String }) address: string,
    @CurrentUser() _user: User,
  ) {
    return this.autoplanService.removeFromWhitelist(address);
  }
}
