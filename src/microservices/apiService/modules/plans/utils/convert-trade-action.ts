import { bigIntSafeJsonParse } from 'src/utils';
import { Collateral } from 'src/web3/platform/gns/v10/types';

export enum TradeActionType {
  TradeOpenedMarket = 'TradeOpenedMarket',
  TradeOpenedLimit = 'TradeOpenedLimit',
  TradeClosedMarket = 'TradeClosedMarket',
  TradeClosedLIQ = 'TradeClosedLIQ',
  TradeClosedSL = 'TradeClosedSL',
  TradeClosedTP = 'TradeClosedTP',
  TradeLeverageUpdate = 'TradeLeverageUpdate',
  TradePosSizeIncrease = 'TradePosSizeIncrease',
  TradePosSizeDecrease = 'TradePosSizeDecrease',
}

export const CLOSE_ACTION_TYPES = [
  TradeActionType.TradeClosedMarket,
  TradeActionType.TradeClosedLIQ,
  TradeActionType.TradeClosedSL,
  TradeActionType.TradeClosedTP,
];

enum PendingOrderType {
  MARKET_OPEN,
  MARKET_CLOSE,
  LIMIT_OPEN,
  STOP_OPEN,
  TP_CLOSE,
  SL_CLOSE,
  LIQ_CLOSE,
}

export type TradeHistory = {
  action: TradeActionType;
  collateralPriceUsd: number;
  leverage: number;
  long: number;
  pairIndex: number;
  pnl: number;
  price: number;
  size: number;
};

type ActionInput = {
  name: string;
  args: string;
  blockNumber: number;
  createdAt: Date;
};

export function convertTradeActionToHistory(
  contractId: number,
  action: ActionInput,
  collaterals: Collateral[],
): TradeHistory | null {
  const args = bigIntSafeJsonParse<any>(action.args);

  switch (action.name) {
    case 'PositionSizeIncreaseExecuted': {
      if (args.cancelReason !== 0) {
        return null;
      }

      const collateral = collaterals.find(
        (c) => c.collateralIndex === args.collateralIndex,
      );

      if (!collateral) {
        return null;
      }

      return {
        action: TradeActionType.TradePosSizeIncrease,
        collateralPriceUsd: Number(args.collateralPriceUsd) / 1e8,
        leverage: Number(args.values.newLeverage) / 1000,
        long: Number(args.long),
        pairIndex: args.pairIndex,
        pnl: Number(
          Number(args.values.borrowingFeeCollateral) /
            Number(collateral.precision),
        ),
        price: Number(args.values.newOpenPrice) / 1e10,
        size: Number(
          Number(args.values.newCollateralAmount) /
            Number(collateral.precision),
        ),
      };
    }
    case 'PositionSizeDecreaseExecuted': {
      if (args.cancelReason !== 0) {
        return null;
      }

      const collateral = collaterals.find(
        (c) => c.collateralIndex === args.collateralIndex,
      );

      if (!collateral) {
        return null;
      }

      return {
        action: TradeActionType.TradePosSizeDecrease,
        collateralPriceUsd: Number(args.collateralPriceUsd) / 1e8,
        leverage: Number(args.values.newLeverage) / 1000,
        long: Number(args.long),
        pairIndex: args.pairIndex,
        pnl: Number(
          Number(args.values.borrowingFeeCollateral) /
            Number(collateral.precision),
        ),
        price: Number(args.values.priceAfterImpact) / 1e10,
        size: Number(
          Number(args.values.newCollateralAmount) /
            Number(collateral.precision),
        ),
      };
    }
    case 'LeverageUpdateExecuted': {
      if (args.cancelReason !== 0) {
        return null;
      }

      const collateral = collaterals.find(
        (c) => c.collateralIndex === args.collateralIndex,
      );

      if (!collateral) {
        return null;
      }

      return {
        action: TradeActionType.TradeLeverageUpdate,
        collateralPriceUsd: 0,
        leverage: Number(args.values.newLeverage) / 1e3,
        long: 0,
        pairIndex: args.pairIndex,
        pnl: 0,
        price: Number(args.values.oraclePrice) / 1e10,
        size: Number(
          Number(args.values.newCollateralAmount) /
            Number(collateral.precision),
        ),
      };
    }
    case 'MarketExecuted': {
      const collateral = collaterals.find(
        (c) => c.collateralIndex === args.t.collateralIndex,
      );

      if (!collateral) {
        return null;
      }

      const pnl = args.open
        ? 0
        : Number(
            (Number(args.amountSentToTrader) -
              Number(args.t.collateralAmount)) /
              Number(collateral.precision),
          );

      return {
        action: args.open
          ? TradeActionType.TradeOpenedMarket
          : TradeActionType.TradeClosedMarket,
        collateralPriceUsd: Number(args.collateralPriceUsd) / 1e8,
        leverage: Number(args.t.leverage) / 1e3,
        long: Number(args.t.long),
        pairIndex: args.t.pairIndex,
        pnl,
        price: Number(args.oraclePrice) / 1e10,
        size: Number(
          Number(args.t.collateralAmount) / Number(collateral.precision),
        ),
      };
    }
    case 'LimitExecuted': {
      const collateral = collaterals.find(
        (c) => c.collateralIndex === args.t.collateralIndex,
      );

      if (!collateral) {
        return null;
      }

      const actionNameMap: Record<number, TradeActionType> = {
        [PendingOrderType.LIMIT_OPEN]: TradeActionType.TradeOpenedLimit,
        [PendingOrderType.LIQ_CLOSE]: TradeActionType.TradeClosedLIQ,
        [PendingOrderType.SL_CLOSE]: TradeActionType.TradeClosedSL,
        [PendingOrderType.TP_CLOSE]: TradeActionType.TradeClosedTP,
      };

      if (!actionNameMap[args.orderType]) {
        return null;
      }

      const pnl =
        args.orderType === PendingOrderType.LIMIT_OPEN
          ? 0
          : Number(
              (Number(args.amountSentToTrader) -
                Number(args.t.collateralAmount)) /
                Number(collateral.precision),
            );

      return {
        action: actionNameMap[args.orderType],
        collateralPriceUsd: Number(args.collateralPriceUsd) / 1e8,
        leverage: Number(args.t.leverage) / 1e3,
        long: Number(args.t.long),
        pairIndex: args.t.pairIndex,
        pnl,
        price: Number(args.oraclePrice) / 1e10,
        size: Number(
          Number(args.t.collateralAmount) / Number(collateral.precision),
        ),
      };
    }
    default: {
      return null;
    }
  }
}
