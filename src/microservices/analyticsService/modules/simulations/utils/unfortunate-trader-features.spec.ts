import { Platform } from 'generated/prisma/client';
import { describe, expect, it } from '@jest/globals';

import {
  buildBehavioralFilterVariants,
  calculateUnfortunateTraderFeaturesV1,
  findBehavioralFilterRejection,
  positionToEpisode,
  PositionEpisode,
  validateBehavioralFilterRanges,
} from './unfortunate-trader-features';
import { PerpTradeHistoryOperation } from 'src/microservices/apiService/modules/trade-histories/entities/event-logs.entity';

const start = new Date('2026-01-05T00:00:00.000Z');
const hour = 60 * 60 * 1000;

function episode(index: number, gross: number, size = 100): PositionEpisode {
  const openedAt = new Date(start.getTime() + index * 24 * hour + hour);
  return {
    market: index % 2 ? 'ETH/USD' : 'BTC/USD',
    side: 'LONG',
    openedAt,
    closedAt: new Date(openedAt.getTime() + hour),
    initialSizeUsd: size,
    peakSizeUsd: size,
    initialCollateralUsd: 10,
    peakCollateralUsd: 10,
    initialLeverage: 10,
    peakLeverage: 10,
    grossDirectionalPnlUsd: gross,
    explicitCostUsd: 2,
    netPnlUsd: gross - 2,
  };
}

describe('calculateUnfortunateTraderFeaturesV1', () => {
  it('keeps directional and fee-driven losses distinct', () => {
    const features = calculateUnfortunateTraderFeaturesV1({
      traderAddress: '0xabc',
      platform: Platform.GNS,
      evaluationStart: start,
      evaluationEnd: new Date(start.getTime() + 6 * 24 * hour),
      episodes: [-10, -20, 5, -30, 5].map((pnl, index) => episode(index, pnl)),
    });

    expect(features.persistence.directionalLossEpisodeRate).toEqual({
      numerator: 3,
      denominator: 5,
      value: 0.6,
    });
    expect(features.lossComposition.directionalLossPurity).toBeCloseTo(60 / 66);
    expect(features.activity.activeWindowRatio).toBeCloseTo(5 / 6);
    expect(
      features.persistence.negativeWindowContinuationRate.value,
    ).toBeCloseTo(1 / 3);
    expect(
      features.persistence.negativeToPositiveRecoveryRate.value,
    ).toBeCloseTo(2 / 3);
  });

  it('only produces post-loss ratios after enough prior episodes', () => {
    const episodes = [-1, 1, 1, -1, 1, 1, -1, 1].map((pnl, index) => {
      const item = episode(index, pnl, index === 7 ? 200 : 100);
      item.openedAt = new Date(start.getTime() + index * 24 * hour);
      item.closedAt = new Date(item.openedAt.getTime() + hour);
      return item;
    });
    const features = calculateUnfortunateTraderFeaturesV1({
      traderAddress: '0xabc',
      platform: Platform.GNS,
      evaluationStart: start,
      evaluationEnd: new Date(start.getTime() + 9 * 7 * 24 * hour),
      episodes,
    });

    expect(features.sample.validPostLossObservationCount).toBe(2);
    expect(features.postLossEscalation.medianSizeRatio).toBeNull();
    expect(features.postLossEscalation.sizeIncreaseRate.value).toBeNull();
  });

  it('breaks negative streaks on inactive scheduled windows', () => {
    const features = calculateUnfortunateTraderFeaturesV1({
      traderAddress: '0xabc',
      platform: Platform.GNS,
      evaluationStart: start,
      evaluationEnd: new Date(start.getTime() + 3 * 24 * hour),
      episodes: [episode(0, -10), episode(2, -10)],
    });

    expect(features.persistence.maxNegativeWindowStreak).toBe(1);
  });

  it('calculates post-loss distributions with three valid observations', () => {
    const episodes = [1, 1, 1, -1, 1, -1, 1, -1, 1].map((pnl, index) => {
      const item = episode(
        index,
        pnl,
        index === 4 || index === 6 || index === 8 ? 200 : 100,
      );
      item.openedAt = new Date(start.getTime() + index * 24 * hour);
      item.closedAt = new Date(item.openedAt.getTime() + hour);
      return item;
    });
    const features = calculateUnfortunateTraderFeaturesV1({
      traderAddress: '0xabc',
      platform: Platform.GNS,
      evaluationStart: start,
      evaluationEnd: new Date(start.getTime() + 14 * 24 * hour),
      episodes,
    });

    expect(features.sample.validPostLossObservationCount).toBe(3);
    expect(features.postLossEscalation.medianSizeRatio).not.toBeNull();
    expect(features.postLossActivity.medianLatencyRatio).not.toBeNull();
  });

  it('counts losses with no reentry inside 72 hours', () => {
    const first = episode(0, -1);
    const second = episode(1, 1);
    second.openedAt = new Date(first.closedAt.getTime() + 73 * hour);
    second.closedAt = new Date(second.openedAt.getTime() + hour);
    const features = calculateUnfortunateTraderFeaturesV1({
      traderAddress: '0xabc',
      platform: Platform.GNS,
      evaluationStart: start,
      evaluationEnd: new Date(start.getTime() + 14 * 24 * hour),
      episodes: [first, second],
    });

    expect(features.postLossActivity.noTradeWithin72HoursRate).toEqual({
      numerator: 1,
      denominator: 1,
      value: 1,
    });
  });

  it('excludes still-open concurrent episodes from a post-loss baseline', () => {
    const completed = [0, 1].map((index) => {
      const item = episode(index, 1);
      item.openedAt = new Date(start.getTime() + index * 12 * hour);
      item.closedAt = new Date(item.openedAt.getTime() + hour);
      return item;
    });
    const concurrent = [0, 1, 2].map((index) => {
      const item = episode(index, 1);
      item.openedAt = new Date(start.getTime() + (30 + index) * hour);
      item.closedAt = new Date(start.getTime() + 10 * 24 * hour);
      return item;
    });
    const loss = episode(0, -1);
    loss.openedAt = new Date(start.getTime() + 48 * hour);
    loss.closedAt = new Date(loss.openedAt.getTime() + hour);
    const next = episode(0, 1);
    next.openedAt = new Date(loss.closedAt.getTime() + hour);
    next.closedAt = new Date(next.openedAt.getTime() + hour);

    const features = calculateUnfortunateTraderFeaturesV1({
      traderAddress: '0xabc',
      platform: Platform.GNS,
      evaluationStart: start,
      evaluationEnd: new Date(start.getTime() + 14 * 24 * hour),
      episodes: [...completed, ...concurrent, loss, next],
    });

    expect(features.sample.validPostLossObservationCount).toBe(0);
  });

  it('assigns every close to a daily window without gaps', () => {
    const dailyEpisode = episode(5, -1);
    const features = calculateUnfortunateTraderFeaturesV1({
      traderAddress: '0xabc',
      platform: Platform.GNS,
      evaluationStart: start,
      evaluationEnd: new Date(start.getTime() + 7 * 24 * hour),
      episodes: [dailyEpisode],
    });

    expect(features.sample.gapClosedEpisodeCount).toBe(0);
    expect(features.sample.activeWindowCount).toBe(1);
  });

  it('applies configured behavioral ranges and rejects insufficient data', () => {
    const features = calculateUnfortunateTraderFeaturesV1({
      traderAddress: '0xabc',
      platform: Platform.GNS,
      evaluationStart: start,
      evaluationEnd: new Date(start.getTime() + 6 * 24 * hour),
      episodes: [-1, -1, -1, 1, 1].map((pnl, index) => episode(index, pnl)),
    });

    expect(
      findBehavioralFilterRejection(features, {
        negativeActiveDayRate: [{ min: 0.5, max: 0.7 }],
      }),
    ).toBeUndefined();
    expect(
      findBehavioralFilterRejection(features, {
        medianPostLossLeverageRatio: [{ min: 1, max: 2 }],
      }),
    ).toBe('BEHAVIORAL_INSUFFICIENT_DATA:medianPostLossLeverageRatio');

    const purity = features.lossComposition.directionalLossPurity!;
    expect(
      findBehavioralFilterRejection(features, {
        directionalLossPurity: [{ min: purity, max: purity }],
      }),
    ).toBeUndefined();
    expect(
      findBehavioralFilterRejection(features, {
        directionalLossPurity: [{ min: purity + 0.01, max: 1 }],
      }),
    ).toBe('BEHAVIORAL_OUT_OF_RANGE:directionalLossPurity');
  });

  it('supports sufficient post-loss leverage and an unbounded maximum', () => {
    const features = calculateUnfortunateTraderFeaturesV1({
      traderAddress: '0xabc',
      platform: Platform.GMX,
      evaluationStart: start,
      evaluationEnd: new Date(start.getTime() + 14 * 24 * hour),
      episodes: [1, 1, 1, -1, 1, -1, 1, -1, 1].map((pnl, index) =>
        episode(index, pnl),
      ),
    });

    expect(features.postLossEscalation.medianLeverageRatio).toBe(1);
    expect(
      findBehavioralFilterRejection(features, {
        medianPostLossLeverageRatio: [{ min: 1, max: null }],
      }),
    ).toBeUndefined();
    expect(
      findBehavioralFilterRejection(features, {
        medianPostLossLeverageRatio: [{ min: 1.25, max: null }],
      }),
    ).toBe('BEHAVIORAL_OUT_OF_RANGE:medianPostLossLeverageRatio');
  });

  it('expands each behavioral bucket into an independent variant', () => {
    expect(
      buildBehavioralFilterVariants({
        negativeActiveDayRate: [
          { min: 0, max: 0.4 },
          { min: 0.4, max: 0.6 },
          { min: 0.6, max: 1 },
        ],
      }),
    ).toEqual([
      { negativeActiveDayRate: [{ min: 0, max: 0.4 }] },
      { negativeActiveDayRate: [{ min: 0.4, max: 0.6 }] },
      { negativeActiveDayRate: [{ min: 0.6, max: 1 }] },
    ]);
    expect(() =>
      buildBehavioralFilterVariants({
        negativeActiveDayRate: [{ min: 0, max: 1 }],
        directionalLossPurity: [{ min: 0, max: 1 }],
      }),
    ).toThrow('one filter feature at a time');
  });

  it('validates rate bounds and only permits an unbounded leverage maximum', () => {
    expect(() =>
      validateBehavioralFilterRanges({
        negativeActiveDayRate: [{ min: 0, max: 1.01 }],
      }),
    ).toThrow('max must be less than or equal to 1');
    expect(() =>
      validateBehavioralFilterRanges({
        directionalLossPurity: [{ min: 0.6, max: null }],
      }),
    ).toThrow('max is required for rate filters');
    expect(() =>
      validateBehavioralFilterRanges({
        medianPostLossLeverageRatio: [{ min: 1.25, max: null }],
      }),
    ).not.toThrow();
  });

  it('normalizes GNS PnL withdrawals into USD', () => {
    const histories = [
      {
        operation: PerpTradeHistoryOperation.OPEN,
        date: new Date(start.getTime() + hour),
        platform: Platform.GNS,
        pair: 'BTC/USD',
        isLong: true,
        sizeInUsd: 100,
        collateralInUsd: 10,
        leverage: 10,
        usdPnl: 0,
        usdFee: 0,
        collateralUsdPrice: 2,
      },
      {
        operation: PerpTradeHistoryOperation.PNL_WITHDRAW,
        date: new Date(start.getTime() + 2 * hour),
        platform: Platform.GNS,
        pair: 'BTC/USD',
        isLong: true,
        sizeInUsd: 100,
        collateralInUsd: 10,
        leverage: 10,
        usdPnl: 10,
        usdFee: 0,
        collateralUsdPrice: 2,
      },
      {
        operation: PerpTradeHistoryOperation.CLOSE,
        date: new Date(start.getTime() + 3 * hour),
        platform: Platform.GNS,
        pair: 'BTC/USD',
        isLong: true,
        sizeInUsd: 0,
        collateralInUsd: 0,
        leverage: 0,
        usdPnl: -5,
        usdFee: 0,
        collateralUsdPrice: 2,
      },
    ];

    const converted = positionToEpisode({ histories } as any);
    expect(converted?.netPnlUsd).toBe(15);
    expect(converted?.grossDirectionalPnlUsd).toBe(15);
  });
});
