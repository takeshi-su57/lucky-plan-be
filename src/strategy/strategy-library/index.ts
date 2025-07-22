import { PositionSizeDecreaseExecutedEventArgs } from 'src/actions/eventParsers/position-size-decrease-executed.parser';
import { PositionSizeIncreaseExecutedEventArgs } from 'src/actions/eventParsers/position-size-increase-executed.parser';
import { Collateral, Trade } from 'src/types';
import { Strategy } from '../entities/strategy.entity';

export function getPositionIncreaseParams(
  strategy: Strategy,
  increaseEventArgs: PositionSizeIncreaseExecutedEventArgs,
  trade: Trade,
) {
  const collateralDelta = BigInt(increaseEventArgs.collateralDelta);
  const newLeverage = Math.min(
    strategy.maxLeverage,
    Number(increaseEventArgs.values.newLeverage),
  );
  const oldLeverage = Number(trade.leverage);

  const isLeverageUpdate = collateralDelta === 0n;

  if (isLeverageUpdate) {
    const leverageDelta = newLeverage - oldLeverage;

    // no need to increase position
    if (leverageDelta <= 0) {
      return null;
    }

    return {
      collateralDelta: 0n,
      leverageDelta,
      expectedPrice: BigInt(increaseEventArgs.values.newOpenPrice),
    };
  }

  if (newLeverage > oldLeverage) {
    const leverageDelta = newLeverage - oldLeverage;

    return {
      collateralDelta: 0n,
      leverageDelta,
      expectedPrice: BigInt(increaseEventArgs.values.newOpenPrice),
    };
  }

  if (strategy.strategyKey === 'ratioCopy') {
    const collateralDelta = BigInt(
      Math.floor(Number(increaseEventArgs.collateralDelta) * strategy.ratio),
    );

    return {
      collateralDelta,
      leverageDelta: Number(increaseEventArgs.leverageDelta),
      expectedPrice: BigInt(increaseEventArgs.values.newOpenPrice),
    };
  }

  throw new Error(`Unsupported strategy key: ${strategy.strategyKey}`);

  // return {
  //   collateralDelta: BigInt(
  //     Math.floor(
  //       (Number(trade.collateralAmount) * Number(levF - levL)) /
  //         Number(levL - 1100),
  //     ),
  //   ),
  //   leverageDelta: 1100,
  //   expectedPrice: BigInt(increaseEventArgs.values.newOpenPrice),
  // };
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
    // no need to decrease position
    if (
      Number(decreaseEventArgs.values.newLeverage) >= Number(trade.leverage)
    ) {
      return null;
    }

    return {
      collateralDelta: 0n,
      leverageDelta:
        Number(trade.leverage) - Number(decreaseEventArgs.values.newLeverage),
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

const DEGEN_PAIRS = [300, 313, 314, 326, 327];

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
  pairIndex: number,
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

  const leverage = DEGEN_PAIRS.includes(pairIndex)
    ? args.leverage
    : Math.max(
        strategy.minLeverage,
        Math.min(strategy.maxLeverage, args.leverage),
      );

  return {
    leverage,
    collateralAmount: ratioAmount,
  };
}
