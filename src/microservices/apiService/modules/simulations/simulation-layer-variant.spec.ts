import { describe, expect, it } from '@jest/globals';

import { buildLayerVariantParameterGrid } from './simulation-research.utils';

describe('buildLayerVariantParameterGrid', () => {
  it('generates only Layer 2 and Layer 3 combinations', () => {
    const variants = buildLayerVariantParameterGrid({
      leaderExecutionCollateral: [
        { ranges: [{ min: 10, max: 100 }] },
        { ranges: [{ min: 100, max: 200 }] },
      ],
      leaderExecutionSize: [{ ranges: [{ min: 500, max: 1000 }] }],
      leaderExecutionLeverage: [{ ranges: [{ min: 2, max: 10 }] }],
      followerRiskSize: [
        { ranges: [{ min: 50, max: 100 }] },
        { ranges: [{ min: 100, max: 200 }] },
      ],
      followerRiskCollateral: [{ ranges: [{ min: 10, max: 50 }] }],
    });

    expect(variants).toHaveLength(4);
    expect(variants[0]).toEqual({
      leaderExecutionCollateral: [{ min: 10, max: 100 }],
      leaderExecutionSize: [{ min: 500, max: 1000 }],
      leaderExecutionLeverage: [{ min: 2, max: 10 }],
      followerRiskSize: [{ min: 50, max: 100 }],
      followerRiskCollateral: [{ min: 10, max: 50 }],
    });
  });

  it('preserves OR ranges inside one simulation variant', () => {
    const variants = buildLayerVariantParameterGrid({
      leaderExecutionCollateral: [
        {
          ranges: [
            { min: 10, max: 20 },
            { min: 50, max: 60 },
          ],
        },
      ],
      leaderExecutionSize: [{ ranges: [{ min: 100, max: 200 }] }],
      leaderExecutionLeverage: [{ ranges: [{ min: 1, max: 5 }] }],
      followerRiskSize: [{ ranges: [{ min: 10, max: 20 }] }],
      followerRiskCollateral: [{ ranges: [{ min: 5, max: 10 }] }],
    });

    expect(variants).toHaveLength(1);
    expect(variants[0].leaderExecutionCollateral).toEqual([
      { min: 10, max: 20 },
      { min: 50, max: 60 },
    ]);
  });
});
