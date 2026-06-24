import { DecodeEventLogReturnType, getAbiItem } from 'viem';
import { gnsMultiCollatDiamondAbi } from '../abi/GNSMultiCollatDiamond';
import { actionToEvent, eventToAction } from 'src/utils';
import { getGnsPositionKey } from '../../utils';
import {
  PurePerpTradeHistory,
  PerpTradeHistoryOperation,
} from 'src/microservices/apiService/modules/trade-histories/entities/event-logs.entity';
import { getCollateral, getPairName } from '../configs';

export const eventName = 'MarketExecuted';

export const abiItem = getAbiItem({
  abi: gnsMultiCollatDiamondAbi,
  name: eventName,
});

export type MarketExecutedEvent = DecodeEventLogReturnType<
  typeof gnsMultiCollatDiamondAbi,
  typeof eventName
>;
export type MarketExecutedEventArgs = MarketExecutedEvent['args'];

export function parseMarketExecutedEvent(event: MarketExecutedEvent) {
  return eventToAction(
    event.eventName,
    getGnsPositionKey(event.args.t.user, event.args.t.index),
    event.args.t.user,
    event.args,
  );
}

export function eventToPerpTradeHistory(
  chainId: number,
  event: MarketExecutedEvent,
): PurePerpTradeHistory | null {
  const collateral = getCollateral(chainId, event.args.t.collateralIndex);

  const pairName = getPairName(chainId, Number(event.args.t.pairIndex));

  if (!collateral || !pairName) {
    return null;
  }

  const operation = event.args.open
    ? PerpTradeHistoryOperation.OPEN
    : PerpTradeHistoryOperation.CLOSE;

  const collateralUsdPrice = Number(event.args.collateralPriceUsd) / 1e8;

  let usdPnl = 0;
  let usdBasePnl = 0;
  let usdFee = 0;

  const collateralUsd =
    Number(
      Number(event.args.t.collateralAmount) / Number(collateral.precision),
    ) * collateralUsdPrice;

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

  const collateralInUsd = operation === 'open' ? collateralUsd : 0;
  const leverage = Number(event.args.t.leverage) / 1e3;

  const sizeInUsd = collateralInUsd * leverage;

  const collateralDeltaUsd = operation === 'open' ? 0 : collateralUsd;
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
  };
}

export const marketExecutedEventParser = {
  eventName,
  logParser: parseMarketExecutedEvent,
  actionParser: actionToEvent<
    MarketExecutedEventArgs & { isManualOpen?: boolean }
  >,
  eventToPerpTradeHistory,
};
