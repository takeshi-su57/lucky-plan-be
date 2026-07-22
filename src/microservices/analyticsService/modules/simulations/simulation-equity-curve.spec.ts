import { describe, expect, it } from '@jest/globals';

import {
  buildRealizedEquityCurve,
  mergeRealizedEquityCurves,
} from './simulation-equity-curve';

describe('simulation equity curve', () => {
  it('orders follower cash flows and converts PNL withdrawals to USD', () => {
    expect(
      buildRealizedEquityCurve([
        {
          histories: [
            { follower: { date: '2026-01-02T00:00:00.000Z', usdPnl: 4 } },
            {
              follower: {
                date: '2026-01-01T00:00:00.000Z',
                operation: 'PNL_WITHDRAW',
                usdPnl: 2,
                collateralUsdPrice: 3,
              },
            },
          ],
        },
      ]),
    ).toEqual([
      {
        timestamp: '2026-01-01T00:00:00.000Z',
        realizedPnlUsd: 6,
        equityUsd: 6,
      },
      {
        timestamp: '2026-01-02T00:00:00.000Z',
        realizedPnlUsd: 4,
        equityUsd: 10,
      },
    ]);
  });

  it('merges curves using each curve delta, not its running balance', () => {
    expect(
      mergeRealizedEquityCurves([
        [
          {
            timestamp: '2026-01-01T00:00:00.000Z',
            realizedPnlUsd: 2,
            equityUsd: 2,
          },
        ],
        [
          {
            timestamp: '2026-01-01T00:00:00.000Z',
            realizedPnlUsd: -1,
            equityUsd: -1,
          },
        ],
      ]),
    ).toEqual([
      {
        timestamp: '2026-01-01T00:00:00.000Z',
        realizedPnlUsd: 1,
        equityUsd: 1,
      },
    ]);
  });
});
