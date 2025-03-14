import { Inject } from '@nestjs/common';
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

@Resolver()
export class PlansResolver {
  constructor(
    private readonly plansService: PlansService,
    @Inject(PUB_SUB) private readonly pubSub: PubSub,
  ) {}

  @Mutation(() => Plan)
  createPlan(@Args('createPlanInput') createPlanInput: CreatePlanInput) {
    return this.plansService.create(createPlanInput);
  }

  @Mutation(() => Int)
  deletePlan(@Args('id', { type: () => Int }) id: number) {
    return this.plansService.delete(id);
  }

  @Mutation(() => Plan)
  updatePlan(@Args('updatePlanInput') updatePlanInput: UpdatePlanInput) {
    return this.plansService.update(updatePlanInput);
  }

  @Mutation(() => Boolean)
  startPlan(@Args('id', { type: () => Int }) id: number) {
    return this.plansService.start(id);
  }

  @Mutation(() => Boolean)
  endPlan(@Args('id', { type: () => Int }) id: number) {
    return this.plansService.end(id);
  }

  @Mutation(() => PlanForwardDetails)
  addBotsToPlan(
    @Args('planId', { type: () => Int }) planId: number,
    @Args('botIds', { type: () => [Int] }) botIds: number[],
  ) {
    return this.plansService.addBotsToPlan(planId, botIds);
  }

  @Subscription(() => Plan, {
    name: SUBSCRIPTION_TOKEN.planCreated,
  })
  subscribeToPlanCreated() {
    return this.pubSub.asyncIterableIterator(SUBSCRIPTION_TOKEN.planCreated);
  }

  @Subscription(() => Plan, {
    name: SUBSCRIPTION_TOKEN.planUpdated,
  })
  subscribeToPlanUpdated() {
    return this.pubSub.asyncIterableIterator(SUBSCRIPTION_TOKEN.planUpdated);
  }

  @Query(() => PlanConnection)
  getPlansByStatus(
    @Args('status', { type: () => PlanStatus })
    status: PlanStatus,
    @Args('first', { type: () => Int }) first: number,
    @Args('after', { type: () => Int, nullable: true }) after: number | null,
  ) {
    return this.plansService.getPlansByStatus(status, first, after);
  }

  @Query(() => PlanForwardDetails, { nullable: true })
  getPlanById(@Args('id', { type: () => Int }) id: number) {
    return this.plansService.getPlanById(id);
  }
}
