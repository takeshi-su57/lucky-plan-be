import { Resolver, Query, Mutation, Args, Int } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { UserPermission } from 'generated/prisma/client';

import { SimulationsService } from './simulations.service';
import {
  SimulationBot,
  SimulationPlan,
  SimulationPlanDetails,
  SimulationPlanConnection,
  Simulation,
  SimulationConnection,
  SimulationLeaderSelection,
  SimulationResearch,
  SimulationResearchConnection,
  SimulationResearchDetails,
} from './entities/simulations.entity';
import {
  CreateSimulationPlanInput,
  CreateSimulationBotInput,
  UpdateSimulationBotInput,
  CreateSimulationInput,
  CreateSimulationResearchInput,
  UpdateSimulationInput,
} from './dto/simulations.input';
import { Roles } from '../auth/roles.decorator';
import { GqlAuthGuard } from '../auth/gql-auth.guard';
import { RolesGuard } from '../auth/gql-role.guard';

@Resolver()
export class SimulationsResolver {
  constructor(private readonly simulationsService: SimulationsService) {}

  @Mutation(() => Simulation)
  createSimulation(@Args('input') input: CreateSimulationInput) {
    return this.simulationsService.createSimulation(input);
  }

  @Mutation(() => SimulationResearch)
  createSimulationResearch(
    @Args('input') input: CreateSimulationResearchInput,
  ) {
    return this.simulationsService.createSimulationResearch(input);
  }

  @Mutation(() => Simulation)
  updateSimulation(@Args('input') input: UpdateSimulationInput) {
    return this.simulationsService.updateSimulation(input);
  }

  @Mutation(() => Simulation)
  playAutoSimulation(@Args('id', { type: () => Int }) id: number) {
    return this.simulationsService.playAutoSimulation(id);
  }

  @Mutation(() => Simulation)
  cancelSimulation(@Args('id', { type: () => Int }) id: number) {
    return this.simulationsService.cancelSimulation(id);
  }

  @Mutation(() => Int)
  @Roles(UserPermission.Admin)
  @UseGuards(GqlAuthGuard, RolesGuard)
  deleteSimulation(@Args('id', { type: () => Int }) id: number) {
    return this.simulationsService.deleteSimulation(id);
  }

  @Mutation(() => Int)
  @Roles(UserPermission.Admin)
  @UseGuards(GqlAuthGuard, RolesGuard)
  deleteSimulationPlan(@Args('id', { type: () => Int }) id: number) {
    return this.simulationsService.deleteSimulationPlan(id);
  }

  @Mutation(() => SimulationPlan)
  createSimulationPlan(@Args('input') input: CreateSimulationPlanInput) {
    return this.simulationsService.createSimulationPlan(input);
  }

  @Mutation(() => SimulationBot)
  updateSimulationBot(@Args('input') input: UpdateSimulationBotInput) {
    return this.simulationsService.updateSimulationBot(input);
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

  @Mutation(() => SimulationBot)
  stopSimulationBot(@Args('id', { type: () => Int }) id: number) {
    return this.simulationsService.stopSimulationBot(id);
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

  @Query(() => SimulationConnection)
  simulations(
    @Args('first', { type: () => Int }) first: number,
    @Args('after', { type: () => Int, nullable: true }) after: number | null,
  ) {
    return this.simulationsService.getSimulations(first, after);
  }

  @Query(() => Simulation, { nullable: true })
  simulation(@Args('id', { type: () => Int }) id: number) {
    return this.simulationsService.getSimulation(id);
  }

  @Query(() => SimulationResearchConnection)
  simulationResearches(
    @Args('first', { type: () => Int }) first: number,
    @Args('after', { type: () => Int, nullable: true }) after: number | null,
  ) {
    return this.simulationsService.getSimulationResearches(first, after);
  }

  @Query(() => SimulationResearchDetails, { nullable: true })
  simulationResearch(@Args('id', { type: () => Int }) id: number) {
    return this.simulationsService.getSimulationResearch(id);
  }

  @Query(() => [Simulation])
  simulationsByResearch(
    @Args('researchId', { type: () => Int }) researchId: number,
  ) {
    return this.simulationsService.getSimulationsByResearch(researchId);
  }

  @Query(() => [SimulationPlan])
  simulationPlansBySimulation(
    @Args('simulationId', { type: () => Int }) simulationId: number,
  ) {
    return this.simulationsService.getSimulationPlansBySimulation(simulationId);
  }

  @Query(() => [SimulationPlanDetails])
  simulationPlanDetailsBySimulation(
    @Args('simulationId', { type: () => Int }) simulationId: number,
  ) {
    return this.simulationsService.getSimulationPlanDetailsBySimulation(
      simulationId,
    );
  }

  @Query(() => [SimulationLeaderSelection])
  simulationLeaderSelections(
    @Args('simulationId', { type: () => Int }) simulationId: number,
    @Args('simulationPlanId', { type: () => Int, nullable: true })
    simulationPlanId: number | null,
  ) {
    return this.simulationsService.getSimulationLeaderSelections(
      simulationId,
      simulationPlanId,
    );
  }
}
