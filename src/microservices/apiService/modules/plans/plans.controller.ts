import { Controller, Inject } from '@nestjs/common';
import { PubSub } from 'graphql-subscriptions';
import { EventPattern, Payload } from '@nestjs/microservices';

import { PUB_SUB } from 'src/global/global.module';
import { PATTERNS, SUBSCRIPTION_TOKEN } from 'src/utils/constants';
import { Plan, SimulationProgressLog } from './entities/plan.entity';

@Controller()
export class PlansController {
  constructor(@Inject(PUB_SUB) private readonly pubSub: PubSub) {}

  @EventPattern(PATTERNS.Plans.PlanCreated)
  async handlePlanCreated(@Payload() plan: Plan) {
    await this.pubSub.publish(SUBSCRIPTION_TOKEN.planCreated, {
      [SUBSCRIPTION_TOKEN.planCreated]: plan,
    });
  }

  @EventPattern(PATTERNS.Plans.PlanUpdated)
  async handlePlanUpdated(@Payload() plan: Plan) {
    await this.pubSub.publish(SUBSCRIPTION_TOKEN.planUpdated, {
      [SUBSCRIPTION_TOKEN.planUpdated]: plan,
    });
  }

  @EventPattern(PATTERNS.Plans.SimulationProgressUpdated)
  async handleSimulationProgressUpdated(
    @Payload() progress: SimulationProgressLog,
  ) {
    await this.pubSub.publish(SUBSCRIPTION_TOKEN.simulationProgressUpdated, {
      [SUBSCRIPTION_TOKEN.simulationProgressUpdated]: progress,
    });
  }
}
