import { AbiEvent, decodeEventLog, getAbiItem, GetLogsReturnType } from 'viem';
import { gnsMultiCollatDiamondAbi } from 'src/abi/GNSMultiCollatDiamond';
import { actionToEvent, eventToAction } from 'src/utils';
import { ActionItem } from '../entities/action.entity';

export const eventName = 'MarketOrderInitiated';

const abiItem = getAbiItem({
  abi: gnsMultiCollatDiamondAbi,
  name: eventName,
});

export type MarketOrderInitiatedEvent = typeof abiItem;
export type MarketOrderInitiatedEventArgs = typeof abiItem.inputs;

export function parseMarketOrderInitiatedEventLog(
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

export function parseMarketOrderInitiatedAction(action: ActionItem) {
  return {
    event: actionToEvent<MarketOrderInitiatedEventArgs>(action),
    action,
  };
}

export const marketOrderInitiatedParser = {
  eventName,
  logParser: parseMarketOrderInitiatedEventLog,
  actionParser: parseMarketOrderInitiatedAction,
};
