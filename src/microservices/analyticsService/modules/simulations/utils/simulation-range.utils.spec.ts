import { describe, expect, it } from '@jest/globals';
import dayjs from 'dayjs';

import { buildSimulationRanges } from './simulation-range.utils';

function formatRangeDates(range: { startedAt: Date; endedAt: Date }) {
  return {
    startedAt: dayjs(range.startedAt).format('YYYY-MM-DD'),
    endedAtExclusive: dayjs(range.endedAt).format('YYYY-MM-DD'),
  };
}

describe('simulation range utils', () => {
  it('builds multi-day windows separated by gap days', () => {
    const ranges = buildSimulationRanges(
      new Date(2026, 6, 1),
      new Date(2026, 6, 10),
      { days: 3, gapDays: 2 },
    );

    expect(ranges.map(formatRangeDates)).toEqual([
      {
        startedAt: '2026-07-01',
        endedAtExclusive: '2026-07-04',
      },
      {
        startedAt: '2026-07-06',
        endedAtExclusive: '2026-07-09',
      },
    ]);
  });

  it('defaults to existing daily ranges', () => {
    const ranges = buildSimulationRanges(
      new Date(2026, 6, 1),
      new Date(2026, 6, 4),
    );

    expect(
      ranges.map((range) => dayjs(range.endedAt).format('YYYY-MM-DD')),
    ).toEqual(['2026-07-02', '2026-07-03', '2026-07-04']);
  });
});
