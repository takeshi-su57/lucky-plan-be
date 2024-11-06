import { AbiEvent, decodeEventLog, getAbiItem, GetLogsReturnType } from 'viem';
import { gnsMultiCollatDiamondAbi } from 'src/abi/GNSMultiCollatDiamond';
import { actionToEvent, eventToAction } from 'src/utils';
import { ActionItem } from '../entities/action.entity';

export const eventName = 'MarketExecuted';

const abiItem = getAbiItem({
  abi: gnsMultiCollatDiamondAbi,
  name: eventName,
});

export type MarketExecutedEvent = typeof abiItem;
export type MarketExecutedEventArgs = typeof abiItem.inputs;

export function parseMarketExecutedEventLog(
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

export function parseMarketExecutedAction(action: ActionItem) {
  return {
    event: actionToEvent<MarketExecutedEventArgs>(action),
    action,
  };
}

export const marketExecutedEventParser = {
  eventName,
  logParser: parseMarketExecutedEventLog,
  actionParser: parseMarketExecutedAction,
};
