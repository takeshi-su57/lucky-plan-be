import { describe, expect, it } from '@jest/globals';

import { allocateFairPlanSlots } from './simulation-dynamic-auto-scheduler.service';

describe('allocateFairPlanSlots', () => {
  it('fills twenty slots fairly across nine simulations', () => {
    const allocation = allocateFairPlanSlots(
      Array.from({ length: 9 }, (_, index) => ({
        simulationId: index + 1,
        outstanding: 0,
        availablePlans: 16,
        order: index,
      })),
      20,
    );
    const counts = allocation.reduce<Record<number, number>>((result, id) => {
      result[id] = (result[id] ?? 0) + 1;
      return result;
    }, {});
    expect(allocation).toHaveLength(20);
    expect(Object.values(counts).sort((a, b) => b - a)).toEqual([
      3, 3, 2, 2, 2, 2, 2, 2, 2,
    ]);
  });

  it('accounts for plans that are already outstanding', () => {
    const allocation = allocateFairPlanSlots(
      [
        { simulationId: 1, outstanding: 2, availablePlans: 4, order: 0 },
        { simulationId: 2, outstanding: 0, availablePlans: 4, order: 1 },
      ],
      4,
    );
    expect(allocation).toEqual([2, 2, 1, 2]);
  });
});
