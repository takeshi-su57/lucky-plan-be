import { describe, expect, it, jest } from '@jest/globals';
import { Simulation } from 'src/microservices/apiService/modules/simulations/entities/simulations.entity';

import { DistributedSimulationEvaluatorService } from './distributed-simulation-evaluator.service';

describe('DistributedSimulationEvaluatorService', () => {
  it('uses only stable evaluation fields in evaluator task input', async () => {
    const tasks = {
      createTask: jest.fn(async () => ({ id: 'task-1' })),
      waitForCompletedTask: jest.fn(async () => ({
        result: { evaluatedCandidates: [] },
      })),
    };
    const service = new DistributedSimulationEvaluatorService(tasks as never);
    const baseSimulation = {
      id: 7,
      platform: 'GNS',
      direction: 'Default',
      trade: [{ min: 1, max: 10 }],
      r2: [{ min: 0, max: 1 }],
      slope: [{ min: -1, max: 1 }],
      standardCollateralUsd: 100,
      collateral: [{ min: 10, max: 100 }],
      size: [{ min: 10, max: 100 }],
      leverage: [{ min: 1, max: 10 }],
      score: [{ min: 0, max: 100 }],
      scoreFormular: 'Default',
      sizingFormular: 'Default',
    } as unknown as Simulation;
    const range = {
      startedAt: new Date('2026-01-01T00:00:00.000Z'),
      endedAt: new Date('2026-01-06T00:00:00.000Z'),
    };

    await service.evaluateLeadersForRange(
      {
        ...baseSimulation,
        cursor: new Date('2026-01-01T00:00:00.000Z'),
        progressPhase: 'leader-selection',
        progressMessage: 'Selecting leaders',
        completedPlans: 3,
      },
      ['0xabc'],
      range,
      new Map(),
    );
    await service.evaluateLeadersForRange(
      {
        ...baseSimulation,
        cursor: new Date('2026-01-06T00:00:00.000Z'),
        progressPhase: 'plan-window-completed',
        progressMessage: 'Completed leaders',
        completedPlans: 4,
      },
      ['0xabc'],
      range,
      new Map(),
    );

    const firstInput = (
      (tasks.createTask as unknown as jest.Mock).mock.calls[0]![0] as {
        input: unknown;
      }
    ).input;
    const secondInput = (
      (tasks.createTask as unknown as jest.Mock).mock.calls[1]![0] as {
        input: unknown;
      }
    ).input;
    expect(firstInput).toEqual(secondInput);
    expect((firstInput as { simulation: unknown }).simulation).toEqual({
      platform: 'GNS',
      direction: 'Default',
      trade: [{ min: 1, max: 10 }],
      r2: [{ min: 0, max: 1 }],
      slope: [{ min: -1, max: 1 }],
      standardCollateralUsd: 100,
      collateral: [{ min: 10, max: 100 }],
      size: [{ min: 10, max: 100 }],
      leverage: [{ min: 1, max: 10 }],
      score: [{ min: 0, max: 100 }],
      scoreFormular: 'Default',
      sizingFormular: 'Default',
    });
  });
});
