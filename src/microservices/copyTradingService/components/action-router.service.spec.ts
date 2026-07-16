import { describe, expect, it, jest } from '@jest/globals';

import { ActionRouterService } from './action-router.service';

jest.mock(
  'src/microservices/apiService/modules/actions/actions.service',
  () => ({
    ActionsService: class {},
  }),
);

jest.mock('src/microservices/apiService/modules/bots/bots.service', () => ({
  BotsService: class {},
}));

jest.mock('./mission-router.service', () => ({
  MissionRouterService: class {},
}));

describe('ActionRouterService', () => {
  it('rebuilds bot context on each load', async () => {
    const botsService = {
      getAllActiveBots: (jest.fn() as any)
        .mockResolvedValueOnce([{ leaderContractId: 1 }])
        .mockResolvedValueOnce([{ leaderContractId: 2 }]),
    };
    const service = new ActionRouterService(
      {} as never,
      botsService as never,
      {} as never,
    );

    await service.loadContext();
    await service.loadContext();

    expect((service as any).bots).toEqual({
      2: [{ leaderContractId: 2 }],
    });
  });

  it('does not throw when a live contract has no active bots', async () => {
    const service = new ActionRouterService(
      { createManyForContract: jest.fn() } as never,
      { getAllActiveBots: jest.fn(async () => []) } as never,
      {
        routeLeaderBotActions: jest.fn(),
        routeFollowerBotActions: jest.fn(),
      } as never,
    );
    const contract = { id: 99 } as never;

    await service.loadContext();

    await expect(
      service.routeLeaderActionItems(contract, 123, []),
    ).resolves.toBeUndefined();
    await expect(
      service.routeFollowerActionItems(contract, 123, []),
    ).resolves.toBeUndefined();
  });
});
