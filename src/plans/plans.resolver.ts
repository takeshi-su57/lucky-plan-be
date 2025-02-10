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
  addBotToPlan(
    @Args('planId', { type: () => Int }) planId: number,
    @Args('botId', { type: () => Int }) botId: number,
  ) {
    return this.plansService.addBotToPlan(planId, botId);
  }

  @Mutation(() => PlanDetails)
  removeBotFromPlan(
    @Args('planId', { type: () => Int }) planId: number,
    @Args('botId', { type: () => Int }) botId: number,
  ) {
    return this.plansService.removeBotFromPlan(planId, botId);
  }

  @Query(() => [PlanDetails])
  getPlansByStatus(
    @Args('status', { type: () => PlanStatus })
    status: PlanStatus,
  ) {
    return this.plansService.getPlansByStatus(status);
  }
}
