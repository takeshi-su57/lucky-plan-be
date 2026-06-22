import { Resolver, Query, Mutation, Args, Int } from '@nestjs/graphql';

import { SimulationsService } from './simulations.service';
import {
  SimulationBot,
  SimulationPlan,
  SimulationPlanDetails,
  SimulationPlanConnection,
} from './entities/simulations.entity';
import {
  CreateSimulationPlanInput,
  CreateSimulationBotInput,
} from './dto/simulations.input';

@Resolver()
export class SimulationsResolver {
  constructor(private readonly simulationsService: SimulationsService) {}

  @Mutation(() => SimulationPlan)
  createSimulationPlan(@Args('input') input: CreateSimulationPlanInput) {
    return this.simulationsService.createSimulationPlan(input);
  }

  @Mutation(() => [SimulationBot])
  batchCreateSimulationBots(
    @Args('inputs', { type: () => [CreateSimulationBotInput] })
    inputs: CreateSimulationBotInput[],
  ) {
    return this.simulationsService.batchCreateSimulationBots(inputs);
  }

  @Mutation(() => SimulationPlan)
  playSimulationPlan(@Args('id', { type: () => Int }) id: number) {
    return this.simulationsService.playSimulationPlan(id);
  }

  @Query(() => SimulationPlanConnection)
  getSimulationPlans(
    @Args('first', { type: () => Int }) first: number,
    @Args('after', { type: () => Int, nullable: true }) after: number | null,
  ) {
    return this.simulationsService.getSimulationPlans(first, after);
  }

  @Query(() => SimulationPlanDetails)
  getSimulationPlanById(@Args('id', { type: () => Int }) id: number) {
    return this.simulationsService.getSimulationPlanById(id);
  }
}
