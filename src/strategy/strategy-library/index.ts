import { PositionSizeDecreaseExecutedEventArgs } from 'src/actions/eventParsers/position-size-decrease-executed.parser';
import { PositionSizeIncreaseExecutedEventArgs } from 'src/actions/eventParsers/position-size-increase-executed.parser';
import { Collateral, Trade } from 'src/types';
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

  if (strategy.strategyKey === 'ratioCopy') {
    return {
      collateralDelta: BigInt(
        Math.floor(Number(increaseEventArgs.collateralDelta) * strategy.ratio),
      ),
      leverageDelta: Number(increaseEventArgs.leverageDelta),
      expectedPrice: BigInt(increaseEventArgs.values.newOpenPrice),
    };
  }

  return {
    collateralDelta: BigInt(
      (BigInt(trade.collateralAmount) * BigInt(levF - levL)) /
        BigInt(levL - 1100),
    ),
    leverageDelta: 1100,
    expectedPrice: BigInt(increaseEventArgs.values.newOpenPrice),
  };
}

export function getPositionDecreaseParams(
  strategy: Strategy,
  decreaseEventArgs: PositionSizeDecreaseExecutedEventArgs,
  trade: Trade,
) {
  const deltaLevL = Number(decreaseEventArgs.leverageDelta);
  const oldPositionSizeCollateral = BigInt(
    decreaseEventArgs.values.existingPositionSizeCollateral,
  );
  const positionSizeDeltaCollateral = BigInt(
    decreaseEventArgs.values.positionSizeCollateralDelta,
  );

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
        (Number(positionSizeDeltaCollateral) /
          Number(oldPositionSizeCollateral)) *
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
    collateral: Collateral;
  },
  leaderCollateralBaseline: number,
  usdcPrice: bigint,
) {
  const collateralUSDCAmount = Math.floor(
    (Number(args.collateralAmount) / Number(args.collateral.precision)) *
      (Number(args.collateralPriceUsd) / Number(usdcPrice)),
  );

  let ratioAmount = BigInt(Math.floor(collateralUSDCAmount * 1e6));

  if (strategy.strategyKey === 'ratioCopy') {
    ratioAmount = BigInt(
      Math.floor(collateralUSDCAmount * strategy.ratio * 1e6),
    );
  }

  if (strategy.strategyKey === 'scaleCopy') {
    const collateralRatio =
      leaderCollateralBaseline > 0
        ? collateralUSDCAmount / leaderCollateralBaseline
        : collateralUSDCAmount;

    ratioAmount = BigInt(
      Math.floor(strategy.collateralBaseline * collateralRatio * 1e6),
    );
  }

  const maxCollateral = BigInt(strategy.maxCollateral * 1e6);
  const minCollateral = BigInt(strategy.minCollateral * 1e6);

  ratioAmount = ratioAmount < maxCollateral ? ratioAmount : maxCollateral;
  ratioAmount = ratioAmount > minCollateral ? ratioAmount : minCollateral;

  return {
    leverage: Math.max(
      Math.min(args.leverage, strategy.maxLeverage),
      strategy.minLeverage,
    ),
    collateralAmount: ratioAmount,
  };
}
