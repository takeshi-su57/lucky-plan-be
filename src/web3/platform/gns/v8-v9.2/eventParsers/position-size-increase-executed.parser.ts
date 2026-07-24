import { actionToEvent, eventToAction } from 'src/utils';
import {
  PurePerpTradeHistory,
  PerpTradeHistoryOperation,
} from 'src/microservices/apiService/modules/trade-histories/entities/event-logs.entity';
import { getGnsPositionKey } from '../../utils';
import { getCollateral, getPairName } from '../../v9/configs';
import {
  V92PositionSizeIncreaseArgs,
  V92PositionSizeIncreaseEvent,
} from './types';

export const eventName = 'PositionSizeIncreaseExecuted';

export function parsePositionSizeIncreaseExecutedEvent(
  event: V92PositionSizeIncreaseEvent,
) {
  return eventToAction(
    event.eventName,
    getGnsPositionKey(event.args.trader, Number(event.args.index)),
    event.args.trader,
    event.args,
  );
}

function isSelfContainedV92Event(
  args: V92PositionSizeIncreaseArgs,
): args is V92PositionSizeIncreaseArgs & {
  long: boolean;
  collateralPriceUsd: bigint;
} {
  return (
    typeof args.long === 'boolean' && args.collateralPriceUsd !== undefined
  );
}

export function eventToPerpTradeHistory(
  chainId: number,
  event: V92PositionSizeIncreaseEvent,
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

  const collateralUsdPrice = Number(args.collateralPriceUsd) / 1e8;
  const precision = Number(collateral.precision);
  const borrowingFee = Number(args.values.borrowingFeeCollateral);
  const openingFees = Number(args.values.openingFeesCollateral);
  const usdFee =
    -((borrowingFee + openingFees) / precision) * collateralUsdPrice;
  const collateralInUsd =
    (Number(args.values.newCollateralAmount) / precision) * collateralUsdPrice;
  const leverage = Number(args.values.newLeverage) / 1e3;
  const sizeInUsd =
    (Number(args.values.newPositionSizeCollateral) / precision) *
    collateralUsdPrice;
  const collateralDeltaUsd =
    (Number(args.collateralDelta) / precision) * collateralUsdPrice;
  const sizeDeltaUsd =
    (Number(args.values.positionSizeCollateralDelta) / precision) *
    collateralUsdPrice;
  const leverageDelta = Number(args.leverageDelta) / 1e3;

  return {
    positionKey: getGnsPositionKey(args.trader, Number(args.index)),
    address: args.trader.toLowerCase() as `0x${string}`,
    pair: pairName,
    operation: PerpTradeHistoryOperation.INCREASE_SIZE,
    usdPnl: usdFee,
    usdBasePnl: 0,
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

export const positionSizeIncreaseExecutedEventParser = {
  eventName,
  logParser: parsePositionSizeIncreaseExecutedEvent,
  actionParser: actionToEvent<V92PositionSizeIncreaseArgs>,
  eventToPerpTradeHistory,
};
