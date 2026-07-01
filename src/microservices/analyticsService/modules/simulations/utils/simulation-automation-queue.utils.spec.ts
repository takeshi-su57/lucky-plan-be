import { describe, expect, it } from '@jest/globals';
import dayjs from 'dayjs';
import { SimulationStatus } from 'generated/prisma/enums';

import {
  buildAutomationHorizon,
  filterReadyAutomationRanges,
  isAutomationStatusEligible,
  isRunningSimulationStale,
} from './simulation-automation-queue.utils';
import { buildSimulationRanges } from './simulation-range.utils';

describe('simulation automation queue utils', () => {
  it('caps the automation horizon at the current day boundary', () => {
    const horizon = buildAutomationHorizon(
      new Date(2026, 9, 1),
      new Date(2026, 6, 1, 12),
    );

    expect(dayjs(horizon).format('YYYY-MM-DD')).toBe('2026-07-01');
  });

  it('uses endAt as the horizon when the simulation has already ended', () => {
    const horizon = buildAutomationHorizon(
      new Date(2026, 5, 1),
      new Date(2026, 6, 1, 12),
    );

    expect(dayjs(horizon).format('YYYY-MM-DD')).toBe('2026-06-01');
  });

  it('filters only ranges after the cursor and up to the horizon', () => {
    const ranges = buildSimulationRanges(
      new Date(2026, 4, 1),
      new Date(2026, 9, 1),
    );

    const readyRanges = filterReadyAutomationRanges(
      ranges,
      new Date(2026, 4, 3),
      new Date(2026, 6, 1),
    );

    expect(dayjs(readyRanges[0].startedAt).format('YYYY-MM-DD')).toBe(
      '2026-05-03',
    );
    expect(dayjs(readyRanges.at(-1)?.endedAt).format('YYYY-MM-DD')).toBe(
      '2026-07-01',
    );
    expect(
      readyRanges.every(
        (range) =>
          range.startedAt.getTime() >= new Date(2026, 4, 3).getTime() &&
          range.endedAt.getTime() <= new Date(2026, 6, 1).getTime(),
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
