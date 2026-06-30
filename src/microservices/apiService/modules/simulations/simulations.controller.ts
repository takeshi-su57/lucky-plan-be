import { Controller, Inject } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import { PubSub } from 'graphql-subscriptions';

import { PUB_SUB } from 'src/global/global.module';
import { PATTERNS, SUBSCRIPTION_TOKEN } from 'src/utils/constants';
import {
  Simulation,
  SimulationPlan,
  SimulationResearch,
} from './entities/simulations.entity';

@Controller()
export class SimulationsController {
  constructor(@Inject(PUB_SUB) private readonly pubSub: PubSub) {}

  @EventPattern(PATTERNS.Simulations.SimulationResearchUpdated)
  async handleSimulationResearchUpdated(
    @Payload() simulationResearch: SimulationResearch,
  ) {
    await this.pubSub.publish(SUBSCRIPTION_TOKEN.simulationResearchUpdated, {
      [SUBSCRIPTION_TOKEN.simulationResearchUpdated]: simulationResearch,
    });
  }

  @EventPattern(PATTERNS.Simulations.SimulationUpdated)
  async handleSimulationUpdated(@Payload() simulation: Simulation) {
    await this.pubSub.publish(SUBSCRIPTION_TOKEN.simulationUpdated, {
      [SUBSCRIPTION_TOKEN.simulationUpdated]: simulation,
    });
  }

  @EventPattern(PATTERNS.Simulations.SimulationPlanUpdated)
  async handleSimulationPlanUpdated(@Payload() simulationPlan: SimulationPlan) {
    await this.pubSub.publish(SUBSCRIPTION_TOKEN.simulationPlanUpdated, {
      [SUBSCRIPTION_TOKEN.simulationPlanUpdated]: simulationPlan,
    });
  }
}
