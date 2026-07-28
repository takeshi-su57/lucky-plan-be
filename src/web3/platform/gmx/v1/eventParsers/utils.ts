import { formatUnits } from 'viem';

import {
  PerpTradeHistoryOperation,
  PurePerpTradeHistory,
} from 'src/microservices/apiService/modules/trade-histories/entities/event-logs.entity';
import { resolveGmxV1Pair } from '../configs';

import { GmxV1PositionEventArgs, NumericValue } from './types';

const GMX_V1_USD_DECIMALS = 30;

export function toBigInt(value: unknown, fallback = 0n): bigint {
  if (typeof value === 'bigint') {
    return value;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return BigInt(Math.trunc(value));
  }

  if (typeof value === 'string' && value.length > 0) {
    try {
      return BigInt(value);
    } catch {
      return fallback;
    }
  }

  return fallback;
}

export function toUsdNumber(value: NumericValue | undefined): number {
  return Number(formatUnits(toBigInt(value), GMX_V1_USD_DECIMALS));
}

function roundLeverage(value: number): number {
  return Math.floor(value * 1_000) / 1_000;
}

export function getGmxV1Pair(chainId: number, indexToken: string): string {
  return resolveGmxV1Pair(chainId, indexToken);
}

export function buildGmxV1PerpTradeHistory(
  chainId: number,
  args: GmxV1PositionEventArgs,
  operation: PerpTradeHistoryOperation,
): PurePerpTradeHistory {
  const usdBasePnl = toUsdNumber(args.basePnlUsd);
  const usdFee = -Math.abs(toUsdNumber(args.feeUsd));
  const sizeInUsd = toUsdNumber(args.sizeInUsd);
  const collateralInUsd = toUsdNumber(args.collateralInUsd);
  const sizeDeltaUsd = toUsdNumber(args.sizeDelta);
  const collateralDeltaUsd = toUsdNumber(args.collateralDelta);
  const leverage =
    collateralInUsd > 0 ? roundLeverage(sizeInUsd / collateralInUsd) : 0;
  const leverageDelta =
    collateralDeltaUsd > 0
      ? roundLeverage(sizeDeltaUsd / collateralDeltaUsd)
      : 0;

  return {
    positionKey: args.positionKey,
    address: args.account,
    pair: getGmxV1Pair(chainId, args.indexToken),
    operation,
    usdPnl: usdBasePnl + usdFee,
    usdBasePnl,
    usdFee,
    sizeInUsd,
    leverage,
    collateralInUsd,
    collateralDeltaUsd,
    sizeDeltaUsd,
    leverageDelta,
    isLong: args.isLong,
    price: toUsdNumber(args.executionPrice),
    collateralUsdPrice: 1,
  };
}
