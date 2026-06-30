import { describe, expect, it } from '@jest/globals';
import { SimulationStatus } from 'generated/prisma/enums';

import {
  buildAutomationHorizon,
  filterReadyAutomationRanges,
  isAutomationStatusEligible,
  isRunningSimulationStale,
} from './simulation-automation-queue.utils';
import { buildDailyRanges } from './simulation-range.utils';

describe('simulation automation queue utils', () => {
  it('caps the automation horizon at the current day boundary', () => {
    const horizon = buildAutomationHorizon(
      new Date('2026-10-01T00:00:00.000Z'),
      new Date('2026-07-01T12:00:00.000Z'),
    );

    expect(horizon.toISOString()).toBe('2026-07-01T00:00:00.000Z');
  });

  it('uses endAt as the horizon when the simulation has already ended', () => {
    const horizon = buildAutomationHorizon(
      new Date('2026-06-01T00:00:00.000Z'),
      new Date('2026-07-01T12:00:00.000Z'),
    );

    expect(horizon.toISOString()).toBe('2026-06-01T00:00:00.000Z');
  });

  it('filters only ranges after the cursor and up to the horizon', () => {
    const ranges = buildDailyRanges(
      new Date('2026-05-01T00:00:00.000Z'),
      new Date('2026-10-01T00:00:00.000Z'),
    );

    const readyRanges = filterReadyAutomationRanges(
      ranges,
      new Date('2026-05-03T00:00:00.000Z'),
      new Date('2026-07-01T00:00:00.000Z'),
    );

    expect(readyRanges[0].startedAt.toISOString()).toBe(
      '2026-05-03T00:00:00.000Z',
    );
    expect(readyRanges.at(-1)?.endedAt.toISOString()).toBe(
      '2026-07-01T00:00:00.000Z',
    );
    expect(
      readyRanges.every(
        (range) =>
          range.startedAt.getTime() >=
            new Date('2026-05-03T00:00:00.000Z').getTime() &&
          range.endedAt.getTime() <=
            new Date('2026-07-01T00:00:00.000Z').getTime(),
      ),
    ).toBe(true);
  });

  it('detects stale running simulations by updatedAt timeout', () => {
    expect(
      isRunningSimulationStale({
        status: SimulationStatus.Running,
        updatedAt: new Date('2026-07-01T11:44:59.000Z'),
        now: new Date('2026-07-01T12:00:00.000Z'),
        staleAfterMs: 15 * 60 * 1000,
        isLocallyActive: false,
      }),
    ).toBe(true);

    expect(
      isRunningSimulationStale({
        status: SimulationStatus.Running,
        updatedAt: new Date('2026-07-01T11:44:59.000Z'),
        now: new Date('2026-07-01T12:00:00.000Z'),
        staleAfterMs: 15 * 60 * 1000,
        isLocallyActive: true,
      }),
    ).toBe(false);
  });

  it('allows only queue statuses for cron automation', () => {
    expect(isAutomationStatusEligible(SimulationStatus.Created)).toBe(true);
    expect(isAutomationStatusEligible(SimulationStatus.Paused)).toBe(true);
    expect(isAutomationStatusEligible(SimulationStatus.Running)).toBe(true);
    expect(isAutomationStatusEligible(SimulationStatus.Completed)).toBe(false);
    expect(isAutomationStatusEligible(SimulationStatus.Cancelled)).toBe(false);
    expect(isAutomationStatusEligible(SimulationStatus.Failed)).toBe(false);
  });
});
