import { Resolver, Query, Mutation, Args, Int } from '@nestjs/graphql';

import { PlansService } from './plans.service';
import { PlanConnection, PlanForwardDetails } from './entities/plan.entity';
import { CreatePlanInput, UpdatePlanInput } from './dto/plan.input';
import { PlanStatus } from '@prisma/client';

@Resolver()
export class PlansResolver {
  constructor(private readonly plansService: PlansService) {}

  @Mutation(() => PlanForwardDetails)
  createPlan(@Args('createPlanInput') createPlanInput: CreatePlanInput) {
    return this.plansService.create(createPlanInput);
  }

  @Mutation(() => Int)
  deletePlan(@Args('id', { type: () => Int }) id: number) {
    return this.plansService.delete(id);
  }

  @Mutation(() => PlanForwardDetails)
  updatePlan(@Args('updatePlanInput') updatePlanInput: UpdatePlanInput) {
    return this.plansService.update(updatePlanInput);
  }

  @Mutation(() => PlanForwardDetails)
  startPlan(@Args('id', { type: () => Int }) id: number) {
    return this.plansService.start(id);
  }

  @Mutation(() => PlanForwardDetails)
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
