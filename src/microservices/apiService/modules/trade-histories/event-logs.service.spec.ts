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
    chainId: 42161,
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

function gmxHistory(
  id: number,
  operation: PerpTradeHistoryOperation,
  date: string,
  positionKey = 'reusable',
): PerpTradeHistory {
  return {
    id,
    address: '0xabc',
    collateralDeltaUsd: 20,
    collateralInUsd: 20,
    collateralUsdPrice: 1,
    contractId: 1,
    chainId: 42161,
    date: new Date(date),
    isLong: true,
    leverage: 5,
    leverageDelta: 0,
    operation,
    pair: 'ETH/USD',
    platform: Platform.GMX,
    positionKey,
    price: 100,
    sizeDeltaUsd: 100,
    sizeInUsd: 100,
    usdBasePnl: operation === PerpTradeHistoryOperation.CLOSE ? id : 0,
    usdFee: 0,
    usdPnl: operation === PerpTradeHistoryOperation.CLOSE ? id : 0,
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

  it('treats repeated GMX opens with the same position key as separate lifecycles', () => {
    const service = new EventLogsService({} as never);

    const result = service.convertToPerpTradePositionsWithSummary(
      Platform.GMX,
      [
        gmxHistory(1, PerpTradeHistoryOperation.OPEN, '2026-05-01T00:00:00Z'),
        gmxHistory(2, PerpTradeHistoryOperation.CLOSE, '2026-05-02T00:00:00Z'),
        gmxHistory(3, PerpTradeHistoryOperation.OPEN, '2026-05-03T00:00:00Z'),
        gmxHistory(4, PerpTradeHistoryOperation.CLOSE, '2026-05-04T00:00:00Z'),
      ],
      {},
    );

    expect(result.totalPositions).toBe(2);
    expect(result.openedPositions).toBe(0);
    expect(
      result.positions.map((position) => position.histories.map((h) => h.id)),
    ).toEqual([
      [1, 2],
      [3, 4],
    ]);
    expect(result.totalPnl).toBe(6);
  });

  it('does not close an earlier GMX lifecycle with a close from a later reused key lifecycle', () => {
    const service = new EventLogsService({} as never);

    const result = service.convertToPerpTradePositionsWithSummary(
      Platform.GMX,
      [
        gmxHistory(1, PerpTradeHistoryOperation.OPEN, '2026-05-01T00:00:00Z'),
        gmxHistory(2, PerpTradeHistoryOperation.OPEN, '2026-05-03T00:00:00Z'),
        gmxHistory(3, PerpTradeHistoryOperation.CLOSE, '2026-05-04T00:00:00Z'),
      ],
      {},
    );

    expect(result.totalPositions).toBe(2);
    expect(result.openedPositions).toBe(1);
    expect(
      result.positions.map((position) => position.histories.map((h) => h.id)),
    ).toEqual([[1], [2, 3]]);
    expect(result.totalPnl).toBe(3);
  });
});
