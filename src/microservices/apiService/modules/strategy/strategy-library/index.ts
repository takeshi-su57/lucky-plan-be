import { Collateral, Trade } from 'src/web3/platform/gns/v10/types';
import { Strategy } from '../entities/strategy.entity';

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
  const newLeverage = Math.min(
    strategy.maxLeverage,
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

  if (newLeverage > oldLeverage) {
    const leverageDelta = newLeverage - oldLeverage;

    return {
      collateralDelta: 0n,
      leverageDelta,
      expectedPrice: BigInt(increaseEventArgs.newOpenPrice),
    };
  }

  if (strategy.strategyKey === 'ratioCopy') {
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
  decreaseEventArgs: {
    leverageDelta: bigint;
    existingPositionSizeCollateral: bigint;
    positionSizeCollateralDelta: bigint;
    newLeverage: bigint;
    oraclePrice: bigint;
  },
  trade: Trade,
) {
  const deltaLevL = Number(decreaseEventArgs.leverageDelta);
  const oldPositionSizeCollateral = BigInt(
    decreaseEventArgs.existingPositionSizeCollateral,
  );
  const positionSizeDeltaCollateral = BigInt(
    decreaseEventArgs.positionSizeCollateralDelta,
  );

  if (deltaLevL > 0) {
    // no need to decrease position
    if (Number(decreaseEventArgs.newLeverage) >= Number(trade.leverage)) {
      return null;
    }

    return {
      collateralDelta: 0n,
      leverageDelta:
        Number(trade.leverage) - Number(decreaseEventArgs.newLeverage),
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

export function getPairKey(pair: string, isLong: boolean) {
  return JSON.stringify({
    pair: pair.toLowerCase(),
    isLong,
  });
}

export function parsePairKey(key: string) {
  return JSON.parse(key) as { pair: string; isLong: boolean };
}

export function getAdditionalParams(strParams: string): {
  maxOpenMissions: number;
  tpPercentage: number;
  slPercentage: number;
  selectedPairs: { pair: string; isLong: boolean }[];
} {
  try {
    const params = JSON.parse(strParams);

    return {
      maxOpenMissions: params.maxOpenMissions || 0,
      tpPercentage: params.tpPercentage || 0,
      slPercentage: params.slPercentage || 0,
      selectedPairs: (params.selectedPairs || [])
        .map((item: { pair: string; isLong: boolean } | string) =>
          typeof item === 'string'
            ? [
                {
                  pair: item.toLowerCase(),
                  isLong: true,
                },
                {
                  pair: item.toLowerCase(),
                  isLong: false,
                },
              ]
            : [
                {
                  pair: item.pair.toLowerCase(),
                  isLong: item.isLong,
                },
              ],
        )
        .flat(),
    };
  } catch {
    return {
      maxOpenMissions: 0,
      tpPercentage: 0,
      slPercentage: 0,
      selectedPairs: [],
    };
  }
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
  leaderCollateralBaseline: number,
) {
  const collateralUSDCAmount = Math.floor(
    (Number(args.collateralAmount) / Number(args.collateral.precision)) *
      (Number(args.collateralPriceUsd) / Number(args.usdcPrice)),
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

  const leverage = DEGEN_PAIRS.includes(args.pairIndex)
    ? args.leverage
    : Math.max(
        strategy.minLeverage,
        Math.min(strategy.maxLeverage, args.leverage),
      );

  const params = getAdditionalParams(strategy.params);

  const tp =
    params.tpPercentage > 0
      ? BigInt(
          Math.floor(
            Number(args.openPrice) *
              (1 + ((args.isLong ? 1 : -1) * params.tpPercentage) / 100),
          ),
        )
      : 0n;
  const sl =
    params.slPercentage > 0
      ? BigInt(
          Math.floor(
            Number(args.openPrice) *
              (1 - ((args.isLong ? 1 : -1) * params.slPercentage) / 100),
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
