import { AbiEvent, decodeEventLog, getAbiItem, GetLogsReturnType } from 'viem';
import { gnsMultiCollatDiamondAbi } from 'src/abi/GNSMultiCollatDiamond';
import { actionToEvent, eventToAction } from 'src/utils';
import { ActionItem } from '../entities/action.entity';

export const eventName = 'MarketCloseCanceled';

const abiItem = getAbiItem({
  abi: gnsMultiCollatDiamondAbi,
  name: eventName,
});

export type MarketCloseCanceledEvent = typeof abiItem;
export type MarketCloseCanceledEventArgs = typeof abiItem.inputs;

export function parseMarketCloseCanceledEventLog(
  log: GetLogsReturnType<AbiEvent>[number],
) {
  const event = decodeEventLog({
    abi: [abiItem],
    data: log.data,
    topics: log.topics,
  });

  return {
    event,
    action: eventToAction(
      event.eventName,
      {
        address: event.args.orderId.user,
        index: event.args.orderId.index,
      },
      event.args,
    ),
  };
}

export function parseMarketCloseCanceledAction(action: ActionItem) {
  return {
    event: actionToEvent<MarketCloseCanceledEventArgs>(action),
    action,
  };
}

export const marketCloseCanceledParser = {
  eventName,
  logParser: parseMarketCloseCanceledEventLog,
  actionParser: parseMarketCloseCanceledAction,
};
