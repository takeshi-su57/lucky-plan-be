import {
  Resolver,
  Query,
  Mutation,
  Args,
  Int,
  Subscription,
} from '@nestjs/graphql';
import { Inject, UseGuards } from '@nestjs/common';
import { UserPermission } from 'generated/prisma/client';
import { PubSub } from 'graphql-subscriptions';

import { SimulationsService } from './simulations.service';
import {
  SimulationBot,
  SimulationPlan,
  SimulationPlanDetails,
  SimulationPlanConnection,
  Simulation,
  SimulationConnection,
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
import { PUB_SUB } from 'src/global/global.module';
import { SUBSCRIPTION_TOKEN } from 'src/utils/constants';

@Resolver()
export class SimulationsResolver {
  constructor(
    private readonly simulationsService: SimulationsService,
    @Inject(PUB_SUB) private readonly pubSub: PubSub,
  ) {}

  @Mutation(() => Simulation)
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  createSimulation(@Args('input') input: CreateSimulationInput) {
    return this.simulationsService.createSimulation(input);
  }

  @Mutation(() => SimulationResearch)
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  createSimulationResearch(
    @Args('input') input: CreateSimulationResearchInput,
  ) {
    return this.simulationsService.createSimulationResearch(input);
  }

  @Mutation(() => Simulation)
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  updateSimulation(@Args('input') input: UpdateSimulationInput) {
    return this.simulationsService.updateSimulation(input);
  }

  @Mutation(() => Simulation)
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  playAutoSimulation(@Args('id', { type: () => Int }) id: number) {
    return this.simulationsService.playAutoSimulation(id);
  }

  @Mutation(() => Simulation)
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  cancelSimulation(@Args('id', { type: () => Int }) id: number) {
    return this.simulationsService.cancelSimulation(id);
  }

  @Mutation(() => SimulationResearch)
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  playAutoResearch(@Args('id', { type: () => Int }) id: number) {
    return this.simulationsService.playAutoResearch(id);
  }

  @Mutation(() => SimulationResearch)
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  pauseResearch(@Args('id', { type: () => Int }) id: number) {
    return this.simulationsService.pauseResearch(id);
  }

  @Mutation(() => SimulationResearch)
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  cancelResearch(@Args('id', { type: () => Int }) id: number) {
    return this.simulationsService.cancelResearch(id);
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
  deleteSimulationResearch(@Args('id', { type: () => Int }) id: number) {
    return this.simulationsService.deleteSimulationResearch(id);
  }

  @Mutation(() => Int)
  @Roles(UserPermission.Admin)
  @UseGuards(GqlAuthGuard, RolesGuard)
  deleteSimulationPlan(@Args('id', { type: () => Int }) id: number) {
    return this.simulationsService.deleteSimulationPlan(id);
  }

  @Mutation(() => Int)
  @Roles(UserPermission.Admin)
  @UseGuards(GqlAuthGuard, RolesGuard)
  deleteSimulationBot(@Args('id', { type: () => Int }) id: number) {
    return this.simulationsService.deleteSimulationBot(id);
  }

  @Mutation(() => SimulationPlan)
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  createSimulationPlan(@Args('input') input: CreateSimulationPlanInput) {
    return this.simulationsService.createSimulationPlan(input);
  }

  @Mutation(() => SimulationBot)
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  updateSimulationBot(@Args('input') input: UpdateSimulationBotInput) {
    return this.simulationsService.updateSimulationBot(input);
  }

  @Mutation(() => [SimulationBot])
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  batchCreateSimulationBots(
    @Args('inputs', { type: () => [CreateSimulationBotInput] })
    inputs: CreateSimulationBotInput[],
  ) {
    return this.simulationsService.batchCreateSimulationBots(inputs);
  }

  @Mutation(() => SimulationPlan)
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  playSimulationPlan(@Args('id', { type: () => Int }) id: number) {
    return this.simulationsService.playSimulationPlan(id);
  }

  @Mutation(() => SimulationBot)
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  stopSimulationBot(@Args('id', { type: () => Int }) id: number) {
    return this.simulationsService.stopSimulationBot(id);
  }

  @Subscription(() => SimulationResearch, {
    name: SUBSCRIPTION_TOKEN.simulationResearchUpdated,
  })
  subscribeToSimulationResearchUpdated() {
    return this.pubSub.asyncIterableIterator(
      SUBSCRIPTION_TOKEN.simulationResearchUpdated,
    );
  }

  @Subscription(() => Simulation, {
    name: SUBSCRIPTION_TOKEN.simulationUpdated,
  })
  subscribeToSimulationUpdated() {
    return this.pubSub.asyncIterableIterator(
      SUBSCRIPTION_TOKEN.simulationUpdated,
    );
  }

  @Subscription(() => SimulationPlan, {
    name: SUBSCRIPTION_TOKEN.simulationPlanUpdated,
  })
  subscribeToSimulationPlanUpdated() {
    return this.pubSub.asyncIterableIterator(
      SUBSCRIPTION_TOKEN.simulationPlanUpdated,
    );
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
}
