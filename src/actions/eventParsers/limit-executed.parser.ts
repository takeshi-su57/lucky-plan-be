import { AbiEvent, decodeEventLog, getAbiItem, GetLogsReturnType } from 'viem';
import { gnsMultiCollatDiamondAbi } from 'src/abi/GNSMultiCollatDiamond';
import { actionToEvent, eventToAction } from 'src/utils';
import { ActionItem } from '../entities/action.entity';

export const eventName = 'LimitExecuted';

const abiItem = getAbiItem({
  abi: gnsMultiCollatDiamondAbi,
  name: eventName,
});

export type LimitExecutedEvent = typeof abiItem;
export type LimitExecutedEventArgs = typeof abiItem.inputs;

export function parseLimitExecutedEventLog(
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

export function parseLimitExecutedAction(action: ActionItem) {
  return {
    event: actionToEvent<LimitExecutedEventArgs>(action),
    action,
  };
}

export const limitExecutedEventParser = {
  eventName,
  logParser: parseLimitExecutedEventLog,
  actionParser: parseLimitExecutedAction,
};
