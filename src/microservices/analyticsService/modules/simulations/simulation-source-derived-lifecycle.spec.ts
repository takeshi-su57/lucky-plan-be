import { describe, expect, it, jest } from '@jest/globals';
import { SimulationStatus } from 'generated/prisma/enums';

import { SimulationsService } from 'src/microservices/apiService/modules/simulations/simulations.service';
import { SimulationAutoRunnerService } from './simulation-auto-runner.service';

describe('source-derived simulation lifecycle', () => {
  it('routes failed research resume through recovery', async () => {
    const service = new SimulationsService(
      {
        simulationResearch: {
          findUnique: jest.fn(async () => ({ status: SimulationStatus.Failed })),
        },
      } as never,
      {} as never,
      {} as never,
    );
    const recovered = { id: 9, status: SimulationStatus.Running };
    const recover = jest
      .spyOn(service, 'recoverResearch')
      .mockResolvedValue(recovered as never);

    await expect(service.resumeResearch(9)).resolves.toBe(recovered);
    expect(recover).toHaveBeenCalledWith(9);
  });

  it('blocks deletion while a derived research depends on the source', async () => {
    const transaction = jest.fn(async (callback: (tx: any) => unknown) =>
      callback({
        simulation: {
          findUnique: jest.fn(async () => ({
            id: 4,
            status: SimulationStatus.Completed,
          })),
        },
        simulationResearch: {
          findFirst: jest.fn(async () => ({ id: 12 })),
        },
      }),
    );
    const service = new SimulationsService(
      { $transaction: transaction } as never,
      {} as never,
      {} as never,
    );

    await expect(service.deleteSimulation(4)).rejects.toThrow(
      'source-derived research 12 depends on it',
    );
  });

  it('does not overwrite a cancelled simulation when recalculation finishes', async () => {
    const updateMany = jest.fn<(...args: any[]) => Promise<{ count: number }>>(
      async () => ({ count: 0 }),
    );
    const runner = new SimulationAutoRunnerService(
      {
        simulationPlan: { findMany: jest.fn(async () => []) },
        simulation: {
          updateMany,
          findUniqueOrThrow: jest.fn(async () => ({
            id: 5,
            status: SimulationStatus.Cancelled,
            trade: [],
            r2: [],
            slope: [],
            collateral: [],
            size: [],
            leverage: [],
            leaderExecutionCollateral: [],
            leaderExecutionSize: [],
            leaderExecutionLeverage: [],
            followerRiskSize: [],
            followerRiskCollateral: [],
            score: [],
          })),
        },
      } as never,
      {} as never,
      {} as never,
      {} as never,
      { emit: jest.fn() } as never,
    );

    const result = await runner.finalizeSourceDerivedSimulation(5);

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 5, status: SimulationStatus.Running },
      }),
    );
    expect(result.status).toBe(SimulationStatus.Cancelled);
  });

  it('restarts derived research without routing it through the evaluator flow', async () => {
    const group = [{ ranges: [{ min: 1, max: 2 }] }];
    const sourceRanges = [{ min: 3, max: 4 }];
    const research = {
      id: 987654,
      sourceSimulationId: 4,
      status: SimulationStatus.Failed,
      simulations: [{ id: 8, status: SimulationStatus.Failed }],
      title: 'derived',
      description: 'derived research',
      platform: 'AVNT',
      direction: 'Reversed',
      startAt: new Date('2026-01-01'),
      endAt: new Date('2026-01-03'),
      days: 1,
      gapDays: 0,
      leaderExecutionCollateral: group,
      leaderExecutionSize: group,
      leaderExecutionLeverage: group,
      followerRiskSize: group,
      followerRiskCollateral: group,
    };
    const createMany = jest.fn<(...args: any[]) => Promise<{ count: number }>>(
      async () => ({ count: 1 }),
    );
    const tx = {
      simulationResearch: {
        findUnique: jest.fn(async () => research),
        update: jest.fn(async () => ({
          ...research,
          status: SimulationStatus.Running,
          simulations: [{ status: SimulationStatus.Running }],
        })),
      },
      simulationPlan: { findMany: jest.fn(async () => []), deleteMany: jest.fn() },
      simulationBot: { deleteMany: jest.fn() },
      simulation: {
        deleteMany: jest.fn(),
        createMany,
        findUnique: jest.fn(async () => ({
          status: SimulationStatus.Completed,
          selectedLeaderCount: 10,
          cursor: new Date('2026-01-03'),
          standardCollateralUsd: 100,
          trade: sourceRanges,
          r2: sourceRanges,
          slope: sourceRanges,
          collateral: sourceRanges,
          size: sourceRanges,
          leverage: sourceRanges,
          score: sourceRanges,
          scoreFormular: 'score',
          sizingFormular: 'size',
          _count: { simulationPlans: 2 },
        })),
      },
    };
    const service = new SimulationsService(
      {
        $transaction: jest.fn(async (callback: (value: any) => unknown) =>
          callback(tx),
        ),
      } as never,
      {} as never,
      {} as never,
    );

    await service.restartResearch(research.id);

    expect(createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          sourceSimulationId: 4,
          status: SimulationStatus.Running,
          trade: sourceRanges,
          leaderExecutionCollateral: [{ min: 1, max: 2 }],
        }),
      ],
    });
  });
});
