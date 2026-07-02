import { describe, expect, it } from '@jest/globals';
import { Platform } from 'generated/prisma/client';

import { EventLogsService } from './event-logs.service';
import {
  PerpTradeHistory,
  PerpTradeHistoryOperation,
} from './entities/event-logs.entity';

function history(
  positionKey: string,
  collateralInUsd: number,
): PerpTradeHistory {
  return {
    id: Number(positionKey.replace('p', '')),
    address: '0xabc',
    collateralDeltaUsd: collateralInUsd,
    collateralInUsd,
    collateralUsdPrice: 1,
    contractId: 1,
    date: new Date(`2026-05-0${positionKey.replace('p', '')}T00:00:00.000Z`),
    isLong: true,
    leverage: 5,
    leverageDelta: 0,
    operation: PerpTradeHistoryOperation.OPEN,
    pair: 'ETH/USD',
    platform: Platform.GNS,
    positionKey,
    price: 100,
    sizeDeltaUsd: collateralInUsd * 5,
    sizeInUsd: collateralInUsd * 5,
    usdBasePnl: 0,
    usdFee: 0,
    usdPnl: 0,
  };
}

describe('EventLogsService', () => {
  it('ignores positions opened outside the collateral filter range', () => {
    const service = new EventLogsService({} as never);

    const result = service.convertToPerpTradePositionsWithSummary(
      Platform.GNS,
      [history('p1', 5), history('p2', 100), history('p3', 1000)],
      {
        minCollateral: 10,
        maxCollateral: 500,
      },
    );

    expect(result.totalPositions).toBe(1);
    expect(
      result.positions.map((position) => position.histories[0].positionKey),
    ).toEqual(['p2']);
    expect(result.avgCollateral).toBe(100);
  });
});
