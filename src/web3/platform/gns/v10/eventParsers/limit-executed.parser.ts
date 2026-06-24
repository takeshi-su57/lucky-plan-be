import { DecodeEventLogReturnType, getAbiItem } from 'viem';
import { gnsMultiCollatDiamondAbi } from '../abi/GNSMultiCollatDiamond';
import { actionToEvent, eventToAction } from 'src/utils';
import { getGnsPositionKey } from '../../utils';
import {
  PurePerpTradeHistory,
  PerpTradeHistoryOperation,
} from 'src/microservices/apiService/modules/trade-histories/entities/event-logs.entity';
import { getCollateral, getPairName } from '../configs';
import { PendingOrderType } from '../types';

export const eventName = 'LimitExecuted';

export const abiItem = getAbiItem({
  abi: gnsMultiCollatDiamondAbi,
  name: eventName,
});

export type LimitExecutedEvent = DecodeEventLogReturnType<
  typeof gnsMultiCollatDiamondAbi,
  typeof eventName
>;
export type LimitExecutedEventArgs = LimitExecutedEvent['args'];

export function parseLimitExecutedEvent(event: LimitExecutedEvent) {
  return eventToAction(
    event.eventName,
    getGnsPositionKey(event.args.t.user, event.args.t.index),
    event.args.t.user,
    event.args,
  );
}

export function eventToPerpTradeHistory(
  chainId: number,
  event: LimitExecutedEvent,
): PurePerpTradeHistory | null {
  const collateral = getCollateral(chainId, event.args.t.collateralIndex);

  const pairName = getPairName(chainId, Number(event.args.t.pairIndex));

  const operationMap: Record<string, PerpTradeHistoryOperation> = {
    [PendingOrderType.LIMIT_OPEN]: PerpTradeHistoryOperation.OPEN,
    [PendingOrderType.LIQ_CLOSE]: PerpTradeHistoryOperation.CLOSE,
    [PendingOrderType.SL_CLOSE]: PerpTradeHistoryOperation.CLOSE,
    [PendingOrderType.TP_CLOSE]: PerpTradeHistoryOperation.CLOSE,
  };

  if (!operationMap[event.args.orderType] || !collateral || !pairName) {
    return null;
  }

  const operation = operationMap[event.args.orderType];

  const collateralUsdPrice = Number(event.args.collateralPriceUsd) / 1e8;

  const collateralUsd =
    Number(
      Number(event.args.t.collateralAmount) / Number(collateral.precision),
    ) * collateralUsdPrice;

  let usdPnl = 0;
  let usdBasePnl = 0;
  let usdFee = 0;

  if (operation !== PerpTradeHistoryOperation.OPEN) {
    usdPnl =
      Number(
        (Number(event.args.amountSentToTrader) -
          Number(event.args.t.collateralAmount)) /
          Number(collateral.precision),
      ) * collateralUsdPrice;
    usdBasePnl = (Number(event.args.percentProfit) * collateralUsd) / 1e12;
    usdFee = usdPnl - usdBasePnl;
  }

  const collateralInUsd =
    operation === PerpTradeHistoryOperation.OPEN ? collateralUsd : 0;
  const leverage = Number(event.args.t.leverage) / 1e3;

  const sizeInUsd = collateralInUsd * leverage;

  const collateralDeltaUsd =
    operation === PerpTradeHistoryOperation.OPEN ? 0 : collateralUsd;
  const leverageDelta = Number(event.args.t.leverage) / 1e3;
  const sizeDeltaUsd = collateralDeltaUsd * leverageDelta;

  return {
    positionKey: getGnsPositionKey(event.args.user, Number(event.args.index)),
    address: event.args.user.toLowerCase() as `0x${string}`,
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
    isLong: event.args.t.long,
    price: Number(event.args.oraclePrice) / 1e10,
    collateralUsdPrice,
  };
}

export const limitExecutedEventParser = {
  eventName,
  logParser: parseLimitExecutedEvent,
  actionParser: actionToEvent<
    LimitExecutedEventArgs & { isManualOpen?: boolean }
  >,
  eventToPerpTradeHistory,
};
