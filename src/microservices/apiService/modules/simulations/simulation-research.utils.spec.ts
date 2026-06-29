import { describe, expect, it } from '@jest/globals';
import { BotMode } from 'generated/prisma/client';

import {
  buildSimulationParameterGrid,
  expandRangeValues,
  getDirectionalSlopeBounds,
  normalizeAbsoluteSlopeBounds,
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
      getDirectionalSlopeBounds(BotMode.Reversed, { min: 1.5, max: 3.5 }),
    ).toEqual({
      minSlope: -3.5,
      maxSlope: -1.5,
    });
  });

  it('builds only valid simulation parameter combinations', () => {
    const combinations = buildSimulationParameterGrid({
      direction: BotMode.Default,
      minTrades: { min: 1, max: 2, gap: 1 },
      maxTrades: { min: 2, max: 3, gap: 1 },
      minR2: { min: 0.2, max: 0.3, gap: 0.1 },
      maxR2: { min: 0.3, max: 0.4, gap: 0.1 },
      minSlopeAbs: { min: 1, max: 2, gap: 1 },
      maxSlopeAbs: { min: 2, max: 3, gap: 1 },
      maxLeverage: { min: 10, max: 20, gap: 10 },
    });

    expect(combinations).toHaveLength(128);
    expect(combinations[0]).toEqual({
      direction: BotMode.Default,
      minTrades: 1,
      maxTrades: 2,
      minR2: 0.2,
      maxR2: 0.3,
      minSlope: 1,
      maxSlope: 2,
      maxLeverage: 10,
    });
    expect(
      combinations.every(
        (item: (typeof combinations)[number]) =>
          item.minTrades <= item.maxTrades &&
          item.minR2 <= item.maxR2 &&
          item.minSlope <= item.maxSlope,
      ),
    ).toBe(true);
  });

  it('keeps reversed slope pairs stored as absolute values', () => {
    const combinations = buildSimulationParameterGrid({
      direction: BotMode.Reversed,
      minTrades: { min: 1, max: 1, gap: 1 },
      maxTrades: { min: 1, max: 1, gap: 1 },
      minR2: { min: 0.5, max: 0.5, gap: 0.1 },
      maxR2: { min: 0.5, max: 0.5, gap: 0.1 },
      minSlopeAbs: { min: 1, max: 3, gap: 2 },
      maxSlopeAbs: { min: 2, max: 2, gap: 1 },
      maxLeverage: { min: 20, max: 20, gap: 1 },
    });

    expect(combinations).toEqual([
      {
        direction: BotMode.Reversed,
        minTrades: 1,
        maxTrades: 1,
        minR2: 0.5,
        maxR2: 0.5,
        minSlope: 1,
        maxSlope: 2,
        maxLeverage: 20,
      },
    ]);
  });
});
