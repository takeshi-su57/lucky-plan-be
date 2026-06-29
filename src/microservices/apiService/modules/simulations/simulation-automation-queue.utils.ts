import dayjs from 'dayjs';

import { SimulationStatus } from 'generated/prisma/enums';
import { WindowRange } from './simulation-range.utils';

export const SIMULATION_AUTOMATION_STALE_AFTER_MS = 15 * 60 * 1000;

export function buildAutomationHorizon(endAt: Date, now = new Date()): Date {
  const today = dayjs(now).startOf('day');
  const end = dayjs(endAt).startOf('day');

  return end.isBefore(today) ? end.toDate() : today.toDate();
}

export function filterReadyAutomationRanges(
  ranges: WindowRange[],
  cursor: Date | null,
  horizon: Date,
): WindowRange[] {
  const startedAt = cursor?.getTime() ?? Number.NEGATIVE_INFINITY;
  const horizonTime = horizon.getTime();

  return ranges.filter(
    (range) =>
      range.endedAt.getTime() > startedAt &&
      range.endedAt.getTime() <= horizonTime,
  );
}

export function isRunningSimulationStale(input: {
  status: SimulationStatus;
  updatedAt: Date;
  now: Date;
  staleAfterMs?: number;
  isLocallyActive: boolean;
}) {
  if (input.status !== SimulationStatus.Running || input.isLocallyActive) {
    return false;
  }

  const staleAfterMs =
    input.staleAfterMs ?? SIMULATION_AUTOMATION_STALE_AFTER_MS;

  return input.now.getTime() - input.updatedAt.getTime() > staleAfterMs;
}

export function isAutomationStatusEligible(status: SimulationStatus) {
  return (
    status === SimulationStatus.Created ||
    status === SimulationStatus.Paused ||
    status === SimulationStatus.Running
  );
}
