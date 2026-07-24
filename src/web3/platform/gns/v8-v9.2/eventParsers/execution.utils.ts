import {
  PurePerpTradeHistory,
  PerpTradeHistoryOperation,
} from 'src/microservices/apiService/modules/trade-histories/entities/event-logs.entity';
import { getGnsPositionKey } from '../../utils';
import { getCollateral, getPairName } from '../../v9/configs';
import { EarlyDiamondExecutionArgs } from './types';

export function earlyDiamondExecutionToPerpTradeHistory({
  chainId,
  args,
  operation,
}: {
  chainId: number;
  args: EarlyDiamondExecutionArgs;
  operation: PerpTradeHistoryOperation;
}): PurePerpTradeHistory | null {
  const collateral = getCollateral(chainId, Number(args.t.collateralIndex));
  const pairName = getPairName(chainId, Number(args.t.pairIndex));

  if (!collateral || !pairName) {
    return null;
  }

  const collateralUsdPrice = Number(args.collateralPriceUsd) / 1e8;
  const collateralUsd =
    (Number(args.t.collateralAmount) / Number(collateral.precision)) *
    collateralUsdPrice;

  let usdPnl = 0;
  let usdBasePnl = 0;
  let usdFee = 0;

  if (operation === PerpTradeHistoryOperation.CLOSE) {
    usdPnl =
      ((Number(args.amountSentToTrader) - Number(args.t.collateralAmount)) /
        Number(collateral.precision)) *
      collateralUsdPrice;
    usdBasePnl = (Number(args.percentProfit) * collateralUsd) / 1e12;
    usdFee = usdPnl - usdBasePnl;
  }

  const collateralInUsd =
    operation === PerpTradeHistoryOperation.OPEN ? collateralUsd : 0;
  const leverage = Number(args.t.leverage) / 1e3;
  const sizeInUsd = collateralInUsd * leverage;
  const collateralDeltaUsd =
    operation === PerpTradeHistoryOperation.CLOSE ? collateralUsd : 0;
  const leverageDelta = leverage;
  const sizeDeltaUsd = collateralDeltaUsd * leverageDelta;

  return {
    positionKey: getGnsPositionKey(args.t.user, Number(args.t.index)),
    address: args.t.user.toLowerCase() as `0x${string}`,
    pair: pairName,
    operation,
    usdPnl,
    usdBasePnl,
    usdFee,
    sizeInUsd,
    leverage,
    collateralInUsd,
    collateralDeltaUsd,
    sizeDeltaUsd,
    leverageDelta,
    isLong: args.t.long,
    price: Number(args.price) / 1e10,
    collateralUsdPrice,
  };
}
