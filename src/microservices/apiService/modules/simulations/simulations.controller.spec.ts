import { describe, expect, it, jest } from '@jest/globals';

import { SUBSCRIPTION_TOKEN } from 'src/utils/constants';
import { SimulationsController } from './simulations.controller';

describe('SimulationsController subscriptions bridge', () => {
  it('publishes simulation research updates to GraphQL subscribers', async () => {
    const pubSub = {
      publish: jest.fn(async () => undefined),
    };
    const controller = new SimulationsController(pubSub as never);
    const simulationResearch = { id: 11 };

    await controller.handleSimulationResearchUpdated(
      simulationResearch as never,
    );

    expect(pubSub.publish.mock.calls[0]).toEqual([
      SUBSCRIPTION_TOKEN.simulationResearchUpdated,
      {
        [SUBSCRIPTION_TOKEN.simulationResearchUpdated]: simulationResearch,
      },
    ]);
  });

  it('publishes simulation updates to GraphQL subscribers', async () => {
    const pubSub = {
      publish: jest.fn(async () => undefined),
    };
    const controller = new SimulationsController(pubSub as never);
    const simulation = { id: 22 };

    await controller.handleSimulationUpdated(simulation as never);

    expect(pubSub.publish.mock.calls[0]).toEqual([
      SUBSCRIPTION_TOKEN.simulationUpdated,
      {
        [SUBSCRIPTION_TOKEN.simulationUpdated]: simulation,
      },
    ]);
  });

  it('publishes simulation plan updates to GraphQL subscribers', async () => {
    const pubSub = {
      publish: jest.fn(async () => undefined),
    };
    const controller = new SimulationsController(pubSub as never);
    const simulationPlan = { id: 33 };

    await controller.handleSimulationPlanUpdated(simulationPlan as never);

    expect(pubSub.publish.mock.calls[0]).toEqual([
      SUBSCRIPTION_TOKEN.simulationPlanUpdated,
      {
        [SUBSCRIPTION_TOKEN.simulationPlanUpdated]: simulationPlan,
      },
    ]);
  });
});
