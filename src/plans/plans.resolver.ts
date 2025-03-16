import { Inject, UseGuards } from '@nestjs/common';
import {
  Resolver,
  Query,
  Mutation,
  Args,
  Int,
  Subscription,
} from '@nestjs/graphql';
import { PlanStatus } from '@prisma/client';
import { PubSub } from 'graphql-subscriptions';

import { PUB_SUB } from 'src/global/global.module';
import { SUBSCRIPTION_TOKEN } from 'src/utils/constants';

import { PlansService } from './plans.service';
import {
  Plan,
  PlanConnection,
  PlanForwardDetails,
} from './entities/plan.entity';
import { CreatePlanInput, UpdatePlanInput } from './dto/plan.input';
import { GqlAuthGuard } from 'src/auth/gql-auth.guard';

@Resolver()
export class PlansResolver {
  constructor(
    private readonly plansService: PlansService,
    @Inject(PUB_SUB) private readonly pubSub: PubSub,
  ) {}

  @Mutation(() => Plan)
  @UseGuards(GqlAuthGuard)
  createPlan(@Args('createPlanInput') createPlanInput: CreatePlanInput) {
    return this.plansService.create(createPlanInput);
  }

  @Mutation(() => Int)
  @UseGuards(GqlAuthGuard)
  deletePlan(@Args('id', { type: () => Int }) id: number) {
    return this.plansService.delete(id);
  }

  @Mutation(() => Plan)
  @UseGuards(GqlAuthGuard)
  updatePlan(@Args('updatePlanInput') updatePlanInput: UpdatePlanInput) {
    return this.plansService.update(updatePlanInput);
  }

  @Mutation(() => Boolean)
  @UseGuards(GqlAuthGuard)
  startPlan(@Args('id', { type: () => Int }) id: number) {
    return this.plansService.start(id);
  }

  @Mutation(() => Boolean)
  @UseGuards(GqlAuthGuard)
  endPlan(@Args('id', { type: () => Int }) id: number) {
    return this.plansService.end(id);
  }

  @Mutation(() => PlanForwardDetails)
  @UseGuards(GqlAuthGuard)
  addBotsToPlan(
    @Args('planId', { type: () => Int }) planId: number,
    @Args('botIds', { type: () => [Int] }) botIds: number[],
  ) {
    return this.plansService.addBotsToPlan(planId, botIds);
  }

  @Subscription(() => Plan, {
    name: SUBSCRIPTION_TOKEN.planCreated,
  })
  @UseGuards(GqlAuthGuard)
  subscribeToPlanCreated() {
    return this.pubSub.asyncIterableIterator(SUBSCRIPTION_TOKEN.planCreated);
  }

  @Subscription(() => Plan, {
    name: SUBSCRIPTION_TOKEN.planUpdated,
  })
  @UseGuards(GqlAuthGuard)
  subscribeToPlanUpdated() {
    return this.pubSub.asyncIterableIterator(SUBSCRIPTION_TOKEN.planUpdated);
  }

  @Query(() => PlanConnection)
  @UseGuards(GqlAuthGuard)
  getPlansByStatus(
    @Args('status', { type: () => PlanStatus })
    status: PlanStatus,
    @Args('first', { type: () => Int }) first: number,
    @Args('after', { type: () => Int, nullable: true }) after: number | null,
  ) {
    return this.plansService.getPlansByStatus(status, first, after);
  }

  @Query(() => PlanForwardDetails, { nullable: true })
  @UseGuards(GqlAuthGuard)
  getPlanById(@Args('id', { type: () => Int }) id: number) {
    return this.plansService.getPlanById(id);
  }
}
