import { DecodeEventLogReturnType, getAbiItem } from 'viem';
import { gnsMultiCollatDiamondAbi } from '../abi/GNSMultiCollatDiamond';
import { actionToEvent, eventToAction } from 'src/utils';
import { getGnsPositionKey } from '../../utils';
import {
  PurePerpTradeHistory,
  PerpTradeHistoryOperation,
} from 'src/microservices/apiService/modules/trade-histories/entities/event-logs.entity';
import { getCollateral, getPairName } from '../configs';
import { CancelReason } from '../types';

export const eventName = 'PositionSizeDecreaseExecuted';

export const abiItem = getAbiItem({
  abi: gnsMultiCollatDiamondAbi,
  name: eventName,
});

export type PositionSizeDecreaseExecutedEvent = DecodeEventLogReturnType<
  typeof gnsMultiCollatDiamondAbi,
  typeof eventName
>;
export type PositionSizeDecreaseExecutedEventArgs =
  PositionSizeDecreaseExecutedEvent['args'];

export function parsePositionSizeDecreaseExecutedEvent(
  event: PositionSizeDecreaseExecutedEvent,
) {
  return eventToAction(
    event.eventName,
    getGnsPositionKey(event.args.trader, Number(event.args.index)),
    event.args.trader,
    event.args,
  );
}

export function eventToPerpTradeHistory(
  chainId: number,
  event: PositionSizeDecreaseExecutedEvent,
): PurePerpTradeHistory | null {
  const collateral = getCollateral(chainId, event.args.collateralIndex);

  const pairName = getPairName(chainId, Number(event.args.pairIndex));

  if (
    !collateral ||
    !pairName ||
    event.args.cancelReason !== CancelReason.NONE
  ) {
    return null;
  }

  const collateralUsdPrice = Number(event.args.collateralPriceUsd) / 1e8;

  let usdBasePnl = 0;
  let usdPnl = 0;
  const usdFee =
    -(
      Number(event.args.values.closingFeeCollateral) /
      Number(collateral.precision)
    ) * collateralUsdPrice;

  if (Number(event.args.collateralDelta) > 0) {
    usdBasePnl =
      Number(
        Number(event.args.values.partialNetPnlCollateral) /
          Number(collateral.precision),
      ) * collateralUsdPrice;

    usdPnl = usdBasePnl + usdFee;
  } else {
    usdPnl = usdFee;
  }

  const collateralInUsd =
    Number(
      Number(event.args.values.newCollateralAmount) /
        Number(collateral.precision),
    ) * collateralUsdPrice;
  const leverage = Number(event.args.values.newLeverage) / 1e3;

  const sizeInUsd = collateralInUsd * leverage;

  const collateralDeltaUsd =
    (Number(event.args.collateralDelta) / Number(collateral.precision)) *
    collateralUsdPrice;
  const leverageDelta = Number(event.args.leverageDelta) / 1e3;
  const sizeDeltaUsd = collateralDeltaUsd * leverageDelta;

  return {
    positionKey: getGnsPositionKey(event.args.trader, Number(event.args.index)),
    address: event.args.trader.toLowerCase() as `0x${string}`,
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
    isLong: event.args.long,
    price: Number(event.args.oraclePrice) / 1e10,
  };
}

export const positionSizeDecreaseExecutedEventParser = {
  eventName,
  logParser: parsePositionSizeDecreaseExecutedEvent,
  actionParser: actionToEvent<PositionSizeDecreaseExecutedEventArgs>,
  eventToPerpTradeHistory,
};
