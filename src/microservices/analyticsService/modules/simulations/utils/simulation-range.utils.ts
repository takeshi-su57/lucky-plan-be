import dayjs from 'dayjs';

export type WindowRange = {
  startedAt: Date;
  endedAt: Date;
};

export type SimulationRangeOptions = {
  days?: number | null;
  gapDays?: number | null;
};

function normalizePositiveInteger(
  value: number | null | undefined,
  fallback: number,
) {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : fallback;
}

function normalizeNonNegativeInteger(
  value: number | null | undefined,
  fallback: number,
) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : fallback;
}

export function buildSimulationRanges(
  startAt: Date,
  endAt: Date,
  options: SimulationRangeOptions = {},
): WindowRange[] {
  const ranges: WindowRange[] = [];
  let cursor = dayjs(startAt).startOf('day');
  const end = dayjs(endAt).startOf('day');
  const days = normalizePositiveInteger(options.days, 1);
  const gapDays = normalizeNonNegativeInteger(options.gapDays, 0);

  while (cursor.isBefore(end)) {
    const nextCursor = cursor.add(days, 'day');

    if (nextCursor.isAfter(end)) {
      break;
    }

    ranges.push({
      startedAt: cursor.toDate(),
      endedAt: nextCursor.toDate(),
    });
    cursor = nextCursor.add(gapDays, 'day');
  }

  return ranges;
}

export function getRangeKey(range: WindowRange) {
  return dayjs(range.startedAt).format('YYYY-MM-DD');
}
