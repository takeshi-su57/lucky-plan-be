import { Resolver, Query, Mutation, Args, Int } from '@nestjs/graphql';

import { PlansService } from './plans.service';
import { PlanDetails } from './entities/plan.entity';
import { CreatePlanInput, UpdatePlanInput } from './dto/plan.input';
import { PlanStatus } from '@prisma/client';

@Resolver()
export class PlansResolver {
  constructor(private readonly plansService: PlansService) {}

  @Mutation(() => PlanDetails)
  createPlan(@Args('createPlanInput') createPlanInput: CreatePlanInput) {
    return this.plansService.create(createPlanInput);
  }

  @Mutation(() => Int)
  deletePlan(@Args('id', { type: () => Int }) id: number) {
    return this.plansService.delete(id);
  }

  @Mutation(() => PlanDetails)
  updatePlan(@Args('updatePlanInput') updatePlanInput: UpdatePlanInput) {
    return this.plansService.update(updatePlanInput);
  }

  @Mutation(() => PlanDetails)
  startPlan(@Args('id', { type: () => Int }) id: number) {
    return this.plansService.start(id);
  }

  @Mutation(() => PlanDetails)
  endPlan(@Args('id', { type: () => Int }) id: number) {
    return this.plansService.end(id);
  }

  @Mutation(() => PlanDetails)
  addBotsToPlan(
    @Args('planId', { type: () => Int }) planId: number,
    @Args('botIds', { type: () => [Int] }) botIds: number[],
  ) {
    return this.plansService.addBotsToPlan(planId, botIds);
  }

  @Query(() => [PlanDetails])
  getPlansByStatus(
    @Args('status', { type: () => PlanStatus })
    status: PlanStatus,
  ) {
    return this.plansService.getPlansByStatus(status);
  }

  @Query(() => PlanDetails, { nullable: true })
  getPlanById(@Args('id', { type: () => Int }) id: number) {
    return this.plansService.getPlanById(id);
  }
}
