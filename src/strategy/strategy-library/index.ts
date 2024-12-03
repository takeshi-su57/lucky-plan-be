import { PositionSizeDecreaseExecutedEventArgs } from 'src/actions/eventParsers/position-size-decrease-executed.parser';
import { PositionSizeIncreaseExecutedEventArgs } from 'src/actions/eventParsers/position-size-increase-executed.parser';
import { Trade } from 'src/types';
import { Strategy } from '../entities/strategy.entity';

export function getPositionIncreaseParams(
  strategy: Strategy,
  increaseEventArgs: PositionSizeIncreaseExecutedEventArgs,
  trade: Trade,
) {
  const levL = Number(increaseEventArgs.values.newLeverage);
  const levF = trade.leverage;

  if (levL > levF) {
    const levDelta = levL - levF;

    return {
      collateralDelta: 0n,
      leverageDelta: Math.min(levDelta, strategy.maxLeverage - levF),
      expectedPrice: BigInt(increaseEventArgs.values.newOpenPrice),
    };
  }

  return {
    collateralDelta: BigInt(
      Math.floor((Number(trade.collateralAmount) * levF) / levL),
    ),
    leverageDelta: 0,
    expectedPrice: BigInt(increaseEventArgs.values.newOpenPrice),
  };
}

export function getPositionDecreaseParams(
  strategy: Strategy,
  decreaseEventArgs: PositionSizeDecreaseExecutedEventArgs,
  trade: Trade,
) {
  const deltaLevL = Number(decreaseEventArgs.leverageDelta);
  const deltaCollL = BigInt(decreaseEventArgs.collateralDelta);

  if (deltaLevL > 0) {
    return {
      collateralDelta: 0n,
      leverageDelta: Math.min(deltaLevL, trade.leverage - strategy.minLeverage),
      expectedPrice: BigInt(decreaseEventArgs.oraclePrice),
    };
  }

  return {
    collateralDelta: BigInt(
      Math.floor(
        Number(deltaCollL / decreaseEventArgs.values.newCollateralAmount) *
          Number(trade.collateralAmount),
      ),
    ),
    leverageDelta: 0,
    expectedPrice: BigInt(decreaseEventArgs.oraclePrice),
  };
}

export function getOpenMissionParams(
  strategy: Strategy,
  args: {
    leverage: number;
    collateralAmount: bigint;
    collateralPriceUsd: bigint;
  },
  usdcPrice: bigint,
) {
  const usdcCollateralAmount =
    (args.collateralAmount * args.collateralPriceUsd) / usdcPrice;

  return {
    leverage: Math.max(
      Math.min(args.leverage, strategy.maxLeverage),
      strategy.minLeverage,
    ),
    collateralAmount: (usdcCollateralAmount * BigInt(strategy.ratio)) / 100n,
  };
}
