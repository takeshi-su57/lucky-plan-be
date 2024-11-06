import { AbiEvent, decodeEventLog, getAbiItem, GetLogsReturnType } from 'viem';
import { gnsMultiCollatDiamondAbi } from 'src/abi/GNSMultiCollatDiamond';
import { actionToEvent, eventToAction } from 'src/utils';
import { ActionItem } from '../entities/action.entity';

export const eventName = 'TradeSlUpdated';

const abiItem = getAbiItem({
  abi: gnsMultiCollatDiamondAbi,
  name: eventName,
});

export type TradeSlUpdatedEvent = typeof abiItem;
export type TradeSlUpdatedEventArgs = typeof abiItem.inputs;

export function parseTradeSlUpdatedEventLog(
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
        address: event.args.user,
        index: event.args.index,
      },
      event.args,
    ),
  };
}

export function parseTradeSlUpdatedAction(action: ActionItem) {
  return {
    event: actionToEvent<TradeSlUpdatedEventArgs>(action),
    action,
  };
}

export const tradeSlUpdatedParser = {
  eventName,
  logParser: parseTradeSlUpdatedEventLog,
  actionParser: parseTradeSlUpdatedAction,
};
