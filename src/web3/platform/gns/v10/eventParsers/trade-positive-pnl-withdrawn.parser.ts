import { DecodeEventLogReturnType, getAbiItem } from 'viem';
import { gnsMultiCollatDiamondAbi } from '../abi/GNSMultiCollatDiamond';
import { actionToEvent, eventToAction } from 'src/utils';
import { getGnsPositionKey } from '../../utils';
import {
  PerpTradeHistoryOperation,
  PurePerpTradeHistory,
} from 'src/microservices/apiService/modules/trade-histories/entities/event-logs.entity';
import { getCollateral } from '../configs';

export const eventName = 'TradePositivePnlWithdrawn';

export const abiItem = getAbiItem({
  abi: gnsMultiCollatDiamondAbi,
  name: eventName,
});

export type TradePositivePnlWithdrawnEvent = DecodeEventLogReturnType<
  typeof gnsMultiCollatDiamondAbi,
  typeof eventName
>;
export type TradePositivePnlWithdrawnEventArgs =
  TradePositivePnlWithdrawnEvent['args'];

export function parseTradePositivePnlWithdrawnEvent(
  event: TradePositivePnlWithdrawnEvent,
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
  event: TradePositivePnlWithdrawnEvent,
): PurePerpTradeHistory | null {
  const collateral = getCollateral(chainId, event.args.collateralIndex);

  const pairName = '';

  if (!collateral) {
    return null;
  }

  let usdPnl =
    Number(event.args.pnlWithdrawnCollateral) / Number(collateral.precision);

  return {
    positionKey: getGnsPositionKey(event.args.trader, Number(event.args.index)),
    address: event.args.trader.toLowerCase() as `0x${string}`,
    pair: pairName,
    operation: PerpTradeHistoryOperation.PNL_WITHDRAW,
    usdPnl,
    usdBasePnl: 0,
    usdFee: 0,
    sizeInUsd: 0,
    leverage: 0,
    collateralInUsd: 0,
    collateralDeltaUsd: 0,
    sizeDeltaUsd: 0,
    leverageDelta: 0,
    isLong: true,
    price: 0,
    collateralUsdPrice: 0,
  };
}

export const tradePositivePnlWithdrawnEventParser = {
  eventName,
  logParser: parseTradePositivePnlWithdrawnEvent,
  actionParser: actionToEvent<TradePositivePnlWithdrawnEventArgs>,
  eventToPerpTradeHistory,
};
