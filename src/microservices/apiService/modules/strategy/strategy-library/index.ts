import { Collateral, Trade } from 'src/web3/platform/gns/v10/types';
import { Strategy } from '../entities/strategy.entity';

export function clampStrategyLeverage(
  strategy: Pick<Strategy, 'minLeverage' | 'maxLeverage'>,
  leverage: number,
) {
  return Math.floor(
    Math.max(strategy.minLeverage, Math.min(strategy.maxLeverage, leverage)),
  );
}

export function getPositionIncreaseParams(
  strategy: Strategy,
  increaseEventArgs: {
    collateralDelta: bigint;
    leverageDelta: bigint;
    newLeverage: bigint;
    newOpenPrice: bigint;
  },
  collateral: Collateral,
  trade: Trade,
) {
  const collateralDelta = BigInt(increaseEventArgs.collateralDelta);
  const newLeverage = clampStrategyLeverage(
    strategy,
    Number(increaseEventArgs.newLeverage),
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
      expectedPrice: BigInt(increaseEventArgs.newOpenPrice),
    };
  }

  const collateralDeltaUSDC = BigInt(
    Math.floor(
      ((Number(increaseEventArgs.collateralDelta) * strategy.ratio) /
        Number(collateral.precision)) *
        1e6,
    ),
  );

  return {
    collateralDelta: collateralDeltaUSDC,
    leverageDelta: Number(increaseEventArgs.leverageDelta),
    expectedPrice: BigInt(increaseEventArgs.newOpenPrice),
  };
}

export function getPositionDecreaseParams(
  strategy: Strategy,
  decreaseEventArgs: {
    isLeverageUpdate: boolean;
    existingPositionSizeCollateral: bigint;
    positionSizeCollateralDelta: bigint;
    oraclePrice: bigint;
  },
  trade: Trade,
) {
  const oldPositionSizeCollateral = BigInt(
    decreaseEventArgs.existingPositionSizeCollateral,
  );
  const positionSizeDeltaCollateral = BigInt(
    decreaseEventArgs.positionSizeCollateralDelta,
  );
  const oldPositionSizeCollateralNumber = Number(oldPositionSizeCollateral);

  if (oldPositionSizeCollateralNumber <= 0) {
    return null;
  }

  const positionSizeDecreaseRatio = Math.min(
    1,
    Number(positionSizeDeltaCollateral) / oldPositionSizeCollateralNumber,
  );

  if (positionSizeDecreaseRatio <= 0) {
    return null;
  }

  if (decreaseEventArgs.isLeverageUpdate) {
    const currentLeverage = Number(trade.leverage);
    const targetLeverage = Math.max(
      strategy.minLeverage,
      Math.floor(currentLeverage * (1 - positionSizeDecreaseRatio)),
    );

    // no need to decrease position
    if (targetLeverage >= currentLeverage) {
      return null;
    }

    return {
      collateralDelta: 0n,
      leverageDelta: currentLeverage - targetLeverage,
      expectedPrice: BigInt(decreaseEventArgs.oraclePrice),
    };
  }

  const collateralDelta = Math.floor(
    Number(trade.collateralAmount) * positionSizeDecreaseRatio,
  );

  if (
    collateralDelta <= 0 ||
    collateralDelta >= Number(trade.collateralAmount)
  ) {
    return null;
  }

  return {
    collateralDelta: BigInt(collateralDelta),
    leverageDelta: 0,
    expectedPrice: BigInt(decreaseEventArgs.oraclePrice),
  };
}

const DEGEN_PAIRS = [300, 313, 314, 326, 327];

export function getPairKey(pair: string, isLong: boolean) {
  return JSON.stringify({
    pair: pair.toLowerCase(),
    isLong,
  });
}

export function parsePairKey(key: string) {
  return JSON.parse(key) as { pair: string; isLong: boolean };
}

export function getOpenMissionParams(
  strategy: Strategy,
  args: {
    leverage: number;
    collateralAmount: bigint;
    collateralPriceUsd: bigint;
    collateral: Collateral;
    isLong: boolean;
    openPrice: bigint;
    usdcPrice: bigint;
    pairIndex: number;
  },
  _leaderCollateralBaseline: number,
) {
  const collateralUSDCAmount = Math.floor(
    (Number(args.collateralAmount) / Number(args.collateral.precision)) *
      (Number(args.collateralPriceUsd) / Number(args.usdcPrice)),
  );

  let ratioAmount = BigInt(
    Math.floor(collateralUSDCAmount * strategy.ratio * 1e6),
  );

  const maxCollateral = BigInt(strategy.maxCollateral * 1e6);
  const minCollateral = BigInt(strategy.minCollateral * 1e6);

  ratioAmount = ratioAmount < maxCollateral ? ratioAmount : maxCollateral;
  ratioAmount = ratioAmount > minCollateral ? ratioAmount : minCollateral;

  const leverage = DEGEN_PAIRS.includes(args.pairIndex)
    ? args.leverage
    : Math.max(
        strategy.minLeverage,
        Math.min(strategy.maxLeverage, args.leverage),
      );

  const tp =
    strategy.tpPercentage > 0
      ? BigInt(
          Math.floor(
            Number(args.openPrice) *
              (1 + ((args.isLong ? 1 : -1) * strategy.tpPercentage) / 100),
          ),
        )
      : 0n;
  const sl =
    strategy.slPercentage > 0
      ? BigInt(
          Math.floor(
            Number(args.openPrice) *
              (1 - ((args.isLong ? 1 : -1) * strategy.slPercentage) / 100),
          ),
        )
      : 0n;

  return {
    leverage,
    collateralAmount: ratioAmount,
    tp,
    sl,
    openPrice: args.openPrice,
    long: args.isLong,
  };
}
