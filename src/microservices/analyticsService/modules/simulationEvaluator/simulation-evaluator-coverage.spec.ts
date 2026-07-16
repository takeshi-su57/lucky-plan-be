import { describe, expect, it } from '@jest/globals';

import {
  coversRange,
  mergeRanges,
  missingRanges,
} from './simulation-evaluator-coverage';

const range = (start: string, end: string) => ({
  coveredStartAt: new Date(start),
  coveredEndAt: new Date(end),
});

describe('simulation evaluator cache coverage', () => {
  it('returns only the uncovered extensions around an existing fragment', () => {
    expect(
      missingRanges(
        [range('2026-02-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z')],
        new Date('2026-01-01T00:00:00.000Z'),
        new Date('2026-04-01T00:00:00.000Z'),
      ),
    ).toEqual([
      range('2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z'),
      range('2026-03-01T00:00:00.000Z', '2026-04-01T00:00:00.000Z'),
    ]);
  });

  it('keeps disjoint fragments, but joins adjacent fragments into one range', () => {
    const fragments = mergeRanges([
      range('2024-01-01T00:00:00.000Z', '2024-02-01T00:00:00.000Z'),
      range('2026-02-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z'),
      range('2026-03-01T00:00:00.000Z', '2026-04-01T00:00:00.000Z'),
    ]);
    expect(fragments).toEqual([
      range('2024-01-01T00:00:00.000Z', '2024-02-01T00:00:00.000Z'),
      range('2026-02-01T00:00:00.000Z', '2026-04-01T00:00:00.000Z'),
    ]);
    expect(
      coversRange(
        fragments,
        new Date('2024-01-01T00:00:00.000Z'),
        new Date('2026-04-01T00:00:00.000Z'),
      ),
    ).toBe(false);
  });
});
