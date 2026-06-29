import { describe, expect, it } from '@jest/globals';
import { BotMode } from 'generated/prisma/client';

import {
  buildSimulationParameterGrid,
  buildValueRangePairs,
  expandRangeValues,
  normalizeAbsoluteSlopeBounds,
  valueMatchesAnyRange,
} from './simulation-research.utils';

describe('simulation research utils', () => {
  it('expands numeric ranges inclusively using the provided gap', () => {
    expect(expandRangeValues({ min: 1, max: 3, gap: 1 })).toEqual([1, 2, 3]);
    expect(expandRangeValues({ min: 0.1, max: 0.3, gap: 0.1 })).toEqual([
      0.1, 0.2, 0.3,
    ]);
  });

  it('keeps stored slope bounds as absolute values', () => {
    expect(
      normalizeAbsoluteSlopeBounds({ min: -1.5, max: 3.5 }),
    ).toEqual({
      minSlope: 1.5,
      maxSlope: 3.5,
    });
  });

  it('derives reversed effective slope bounds as negative signed values', () => {
    expect(
      valueMatchesAnyRange(-2, [
        { min: -3.5, max: -1.5 },
        { min: 1, max: 2 },
      ]),
    ).toBe(true);
  });

  it('builds valid range pairs from min/max ranges', () => {
    expect(
      buildValueRangePairs(
        { min: 1, max: 2, gap: 1 },
        { min: 2, max: 3, gap: 1 },
      ),
    ).toEqual([
      { min: 1, max: 2 },
      { min: 1, max: 3 },
      { min: 2, max: 2 },
      { min: 2, max: 3 },
    ]);
  });

  it('builds only valid simulation parameter combinations', () => {
    const combinations = buildSimulationParameterGrid({
      direction: BotMode.Default,
      trade: [
        { min: 1, max: 2 },
        { min: 2, max: 3 },
      ],
      r2: [
        { min: 0.2, max: 0.3 },
        { min: 0.3, max: 0.4 },
      ],
      slope: [
        { min: 1, max: 2 },
        { min: 2, max: 3 },
      ],
      maxLeverage: [10, 20],
    });

    expect(combinations).toHaveLength(16);
    expect(combinations[0]).toEqual({
      direction: BotMode.Default,
      trade: { min: 1, max: 2 },
      r2: { min: 0.2, max: 0.3 },
      slope: { min: 1, max: 2 },
      maxLeverage: 10,
    });
    expect(
      combinations.every(
        (item: (typeof combinations)[number]) =>
          item.trade.min <= item.trade.max &&
          item.r2.min <= item.r2.max &&
          item.slope.min <= item.slope.max,
      ),
    ).toBe(true);
  });

  it('keeps reversed slope pairs stored as absolute values', () => {
    const combinations = buildSimulationParameterGrid({
      direction: BotMode.Reversed,
      trade: [{ min: 1, max: 1 }],
      r2: [{ min: 0.5, max: 0.5 }],
      slope: [{ min: 1, max: 2 }],
      maxLeverage: [20],
    });

    expect(combinations).toEqual([
      {
        direction: BotMode.Reversed,
        trade: { min: 1, max: 1 },
        r2: { min: 0.5, max: 0.5 },
        slope: { min: 1, max: 2 },
        maxLeverage: 20,
      },
    ]);
  });

  it('uses explicit research selections without expanding generator triplets', () => {
    const trade = [
      { min: 3, max: 10 },
      { min: 10, max: 30 },
    ];
    const r2 = [
      { min: 0.25, max: 0.5 },
      { min: 0.5, max: 0.9 },
    ];
    const slope = [{ min: 1, max: 3 }];
    const maxLeverage = [10, 25, 50];

    const combinations = buildSimulationParameterGrid({
      direction: BotMode.Default,
      trade,
      r2,
      slope,
      maxLeverage,
    });

    expect(combinations).toHaveLength(12);
    expect(combinations[0]).toEqual({
      direction: BotMode.Default,
      trade: { min: 3, max: 10 },
      r2: { min: 0.25, max: 0.5 },
      slope: { min: 1, max: 3 },
      maxLeverage: 10,
    });
  });
});
