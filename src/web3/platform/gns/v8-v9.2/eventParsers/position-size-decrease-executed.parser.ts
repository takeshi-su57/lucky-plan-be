import { actionToEvent, eventToAction } from 'src/utils';
import {
  PurePerpTradeHistory,
  PerpTradeHistoryOperation,
} from 'src/microservices/apiService/modules/trade-histories/entities/event-logs.entity';
import { getGnsPositionKey } from '../../utils';
import { getCollateral, getPairName } from '../../v9/configs';
import {
  V92PositionSizeDecreaseArgs,
  V92PositionSizeDecreaseEvent,
} from './types';

export const eventName = 'PositionSizeDecreaseExecuted';

export function parsePositionSizeDecreaseExecutedEvent(
  event: V92PositionSizeDecreaseEvent,
) {
  return eventToAction(
    event.eventName,
    getGnsPositionKey(event.args.trader, Number(event.args.index)),
    event.args.trader,
    event.args,
  );
}

function isSelfContainedV92Event(
  args: V92PositionSizeDecreaseArgs,
): args is V92PositionSizeDecreaseArgs & {
  long: boolean;
  collateralPriceUsd: bigint;
} {
  return (
    typeof args.long === 'boolean' && args.collateralPriceUsd !== undefined
  );
}

export function eventToPerpTradeHistory(
  chainId: number,
  event: V92PositionSizeDecreaseEvent,
): PurePerpTradeHistory | null {
  const { args } = event;

  // V9.0 emitted an overload without direction or collateral USD price. Those
  // fields cannot be reconstructed safely by this stateless parser.
  if (Number(args.cancelReason) !== 0 || !isSelfContainedV92Event(args)) {
    return null;
  }

  const collateral = getCollateral(chainId, Number(args.collateralIndex));
  const pairName = getPairName(chainId, Number(args.pairIndex));

  if (!collateral || !pairName) {
    return null;
  }

  const precision = Number(collateral.precision);
  const collateralUsdPrice = Number(args.collateralPriceUsd) / 1e8;
  const totalFeesCollateral =
    Number(args.values.borrowingFeeCollateral) +
    Number(args.values.vaultFeeCollateral) +
    Number(args.values.gnsStakingFeeCollateral);
  const existingPositionSize = Number(
    args.values.existingPositionSizeCollateral,
  );
  const positionSizeDelta = Number(args.values.positionSizeCollateralDelta);
  const basePnlCollateral =
    existingPositionSize === 0
      ? 0
      : (Number(args.values.existingPnlCollateral) * positionSizeDelta) /
        existingPositionSize;
  const netPnlCollateral = basePnlCollateral - totalFeesCollateral;
  const usdBasePnl = (basePnlCollateral / precision) * collateralUsdPrice;
  const usdFee = -(totalFeesCollateral / precision) * collateralUsdPrice;
  const usdPnl = (netPnlCollateral / precision) * collateralUsdPrice;
  const collateralInUsd =
    (Number(args.values.newCollateralAmount) / precision) * collateralUsdPrice;
  const leverage = Number(args.values.newLeverage) / 1e3;
  const sizeInUsd = collateralInUsd * leverage;
  const collateralDeltaUsd =
    (Number(args.collateralDelta) / precision) * collateralUsdPrice;
  const sizeDeltaUsd = (positionSizeDelta / precision) * collateralUsdPrice;
  const leverageDelta = Number(args.leverageDelta) / 1e3;

  return {
    positionKey: getGnsPositionKey(args.trader, Number(args.index)),
    address: args.trader.toLowerCase() as `0x${string}`,
    pair: pairName,
    operation: PerpTradeHistoryOperation.DECREASE_SIZE,
    usdPnl,
    usdBasePnl,
    usdFee,
    sizeInUsd,
    leverage,
    collateralInUsd,
    collateralDeltaUsd,
    sizeDeltaUsd,
    leverageDelta,
    isLong: args.long,
    price: Number(args.marketPrice) / 1e10,
    collateralUsdPrice,
  };
}

export const positionSizeDecreaseExecutedEventParser = {
  eventName,
  logParser: parsePositionSizeDecreaseExecutedEvent,
  actionParser: actionToEvent<V92PositionSizeDecreaseArgs>,
  eventToPerpTradeHistory,
};
