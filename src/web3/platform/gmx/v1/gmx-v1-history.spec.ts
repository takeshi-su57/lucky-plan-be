import { describe, expect, it } from '@jest/globals';

import { PerpTradeHistoryOperation } from 'src/microservices/apiService/modules/trade-histories/entities/event-logs.entity';

import { gmxV1EventSignatures, gmxV1VaultAbi } from './abi/Vault';
import { gmxV1HistoryCutoff, gmxV1VaultDeployments } from './configs/contracts';
import {
  eventToPerpTradeHistory,
  normalizeGmxV1EventLogs,
} from './eventParsers';
import type { GmxV1LogEnvelope } from './eventParsers/types';

const USD_DECIMALS = 10n ** 30n;
const usd = (value: number) => BigInt(value) * USD_DECIMALS;

const POSITION_KEY = `0x${'11'.repeat(32)}` as const;
const ACCOUNT = `0x${'22'.repeat(20)}` as const;
const WETH = '0x82af49447d8a07e3bd95bd0d56f35241523fbab1' as const;
const TRANSACTION_HASH = `0x${'33'.repeat(32)}`;

function log(
  logIndex: number,
  eventName: string,
  args: Record<string, unknown>,
): GmxV1LogEnvelope {
  return {
    blockNumber: 100,
    logIndex,
    transactionHash: TRANSACTION_HASH,
    eventLog: { eventName, args },
  };
}

describe('GMX V1 historical integration', () => {
  it('pins the official V1 Vault deployments to the requested cutoff', () => {
    expect(gmxV1HistoryCutoff).toEqual({
      iso: '2025-01-01T00:00:00.000Z',
      unixSeconds: 1_735_689_600,
    });

    expect(gmxV1VaultDeployments).toEqual([
      expect.objectContaining({
        chainId: 42_161,
        address: '0x489ee077994b6658eafa855c308275ead8097c4a',
        fromBlock: 227_000,
        toBlock: 290_687_173,
      }),
      expect.objectContaining({
        chainId: 43_114,
        address: '0x9ab2de34a33fb459b538c43f251eb825645e8595',
        fromBlock: 8_351_228,
        toBlock: 55_159_595,
      }),
    ]);
  });

  it('exposes every primary and companion event selector needed for V1 reconstruction', () => {
    expect(gmxV1VaultAbi).toHaveLength(7);
    expect(new Set(Object.values(gmxV1EventSignatures))).toEqual(
      new Set([
        'IncreasePosition',
        'DecreasePosition',
        'LiquidatePosition',
        'UpdatePosition',
        'ClosePosition',
        'UpdatePnl',
        'CollectMarginFees',
      ]),
    );
  });

  it('normalizes an increase and classifies the initial position as open', () => {
    const [normalized] = normalizeGmxV1EventLogs([
      log(2, 'CollectMarginFees', {
        token: WETH,
        feeUsd: usd(2),
        feeTokens: 0n,
      }),
      log(8, 'IncreasePosition', {
        key: POSITION_KEY,
        account: ACCOUNT,
        collateralToken: WETH,
        indexToken: WETH,
        collateralDelta: usd(100),
        sizeDelta: usd(500),
        isLong: true,
        price: usd(2_000),
        fee: usd(2),
      }),
      log(12, 'UpdatePosition', {
        key: POSITION_KEY,
        size: usd(500),
        collateral: usd(98),
        averagePrice: usd(2_000),
        entryFundingRate: 0n,
        reserveAmount: 0n,
        realisedPnl: 0n,
        markPrice: usd(2_000),
      }),
    ]);

    expect(normalized.eventLog.args).toEqual(
      expect.objectContaining({
        positionKey: POSITION_KEY,
        feeUsd: usd(2),
        sizeInUsd: usd(500),
        collateralInUsd: usd(98),
        stateEventName: 'UpdatePosition',
      }),
    );

    const history = eventToPerpTradeHistory(
      42_161,
      normalized.eventLog as never,
    );

    expect(history).toEqual(
      expect.objectContaining({
        positionKey: POSITION_KEY,
        address: ACCOUNT,
        pair: 'eth/usd',
        operation: PerpTradeHistoryOperation.OPEN,
        usdBasePnl: 0,
        usdFee: -2,
        usdPnl: -2,
        sizeInUsd: 500,
        collateralInUsd: 98,
        sizeDeltaUsd: 500,
        collateralDeltaUsd: 100,
        price: 2_000,
        isLong: true,
      }),
    );
    expect(history?.leverage).toBeCloseTo(5.102, 3);
  });

  it('uses UpdatePnl and ClosePosition to build an accurate close history', () => {
    const [normalized] = normalizeGmxV1EventLogs([
      log(1, 'CollectMarginFees', {
        token: WETH,
        feeUsd: usd(3),
        feeTokens: 0n,
      }),
      log(4, 'UpdatePnl', {
        key: POSITION_KEY,
        hasProfit: true,
        delta: usd(50),
      }),
      log(9, 'DecreasePosition', {
        key: POSITION_KEY,
        account: ACCOUNT,
        collateralToken: WETH,
        indexToken: WETH,
        collateralDelta: 0n,
        sizeDelta: usd(500),
        isLong: true,
        price: usd(2_200),
        fee: usd(3),
      }),
      log(13, 'ClosePosition', {
        key: POSITION_KEY,
        size: usd(500),
        collateral: 0n,
        averagePrice: usd(2_000),
        entryFundingRate: 0n,
        reserveAmount: 0n,
        realisedPnl: usd(50),
      }),
    ]);

    expect(normalized.eventLog.args).toEqual(
      expect.objectContaining({
        basePnlUsd: usd(50),
        feeUsd: usd(3),
        sizeInUsd: 0n,
        collateralInUsd: 0n,
        stateEventName: 'ClosePosition',
      }),
    );

    const history = eventToPerpTradeHistory(
      42_161,
      normalized.eventLog as never,
    );

    expect(history).toEqual(
      expect.objectContaining({
        operation: PerpTradeHistoryOperation.CLOSE,
        usdBasePnl: 50,
        usdFee: -3,
        usdPnl: 47,
        sizeInUsd: 0,
        sizeDeltaUsd: 500,
        price: 2_200,
      }),
    );
  });

  it('normalizes liquidation into a terminal close without a state companion', () => {
    const [normalized] = normalizeGmxV1EventLogs([
      log(3, 'CollectMarginFees', {
        token: WETH,
        feeUsd: usd(10),
        feeTokens: 0n,
      }),
      log(10, 'LiquidatePosition', {
        key: POSITION_KEY,
        account: ACCOUNT,
        collateralToken: WETH,
        indexToken: WETH,
        isLong: true,
        size: usd(1_000),
        collateral: usd(100),
        reserveAmount: 0n,
        realisedPnl: 0n,
        markPrice: usd(1_500),
      }),
    ]);

    const history = eventToPerpTradeHistory(
      42_161,
      normalized.eventLog as never,
    );

    expect(normalized.eventLog.args).toEqual(
      expect.objectContaining({
        positionKey: POSITION_KEY,
        sizeDelta: usd(1_000),
        sizeInUsd: 0n,
        collateralInUsd: 0n,
        feeUsd: usd(10),
        basePnlUsd: -usd(90),
      }),
    );
    expect(history).toEqual(
      expect.objectContaining({
        operation: PerpTradeHistoryOperation.CLOSE,
        usdBasePnl: -90,
        usdFee: -10,
        usdPnl: -100,
        price: 1_500,
      }),
    );
  });
});
