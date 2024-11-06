import { AbiEvent, decodeEventLog, getAbiItem, GetLogsReturnType } from 'viem';
import { gnsMultiCollatDiamondAbi } from 'src/abi/GNSMultiCollatDiamond';
import { actionToEvent, eventToAction } from 'src/utils';
import { ActionItem } from '../entities/action.entity';

export const eventName = 'TradeTpUpdated';

const abiItem = getAbiItem({
  abi: gnsMultiCollatDiamondAbi,
  name: eventName,
});

export type TradeTpUpdatedEvent = typeof abiItem;
export type TradeTpUpdatedEventArgs = typeof abiItem.inputs;

export function parseTradeTpUpdatedEventLog(
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

export function parseTradeTpUpdatedAction(action: ActionItem) {
  return {
    event: actionToEvent<TradeTpUpdatedEventArgs>(action),
    action,
  };
}

export const tradeTpUpdatedParser = {
  eventName,
  logParser: parseTradeTpUpdatedEventLog,
  actionParser: parseTradeTpUpdatedAction,
};
