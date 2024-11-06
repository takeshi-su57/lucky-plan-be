import { AbiEvent, decodeEventLog, getAbiItem, GetLogsReturnType } from 'viem';
import { gnsMultiCollatDiamondAbi } from 'src/abi/GNSMultiCollatDiamond';
import { actionToEvent, eventToAction } from 'src/utils';
import { ActionItem } from '../entities/action.entity';

export const eventName = 'PositionSizeIncreaseExecuted';

const abiItem = getAbiItem({
  abi: gnsMultiCollatDiamondAbi,
  name: eventName,
});

export type PositionSizeIncreaseExecutedEvent = typeof abiItem;
export type PositionSizeIncreaseExecutedEventArgs = typeof abiItem.inputs;

export function parsePositionSizeIncreaseExecutedEventLog(
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

export function parsePositionSizeIncreaseExecutedAction(action: ActionItem) {
  return {
    event: actionToEvent<PositionSizeIncreaseExecutedEventArgs>(action),
    action,
  };
}

export const positionSizeIncreaseExecutedParser = {
  eventName,
  logParser: parsePositionSizeIncreaseExecutedEventLog,
  actionParser: parsePositionSizeIncreaseExecutedAction,
};
