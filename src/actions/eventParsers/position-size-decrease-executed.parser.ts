import { AbiEvent, decodeEventLog, getAbiItem, GetLogsReturnType } from 'viem';
import { gnsMultiCollatDiamondAbi } from 'src/abi/GNSMultiCollatDiamond';
import { actionToEvent, eventToAction } from 'src/utils';
import { ActionItem } from '../entities/action.entity';

export const eventName = 'PositionSizeDecreaseExecuted';

const abiItem = getAbiItem({
  abi: gnsMultiCollatDiamondAbi,
  name: eventName,
});

export type PositionSizeDecreaseExecutedEvent = typeof abiItem;
export type PositionSizeDecreaseExecutedEventArgs = typeof abiItem.inputs;

export function parsePositionSizeDecreaseExecutedEventLog(
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

export function parsePositionSizeDecreaseExecutedAction(action: ActionItem) {
  return {
    event: actionToEvent<PositionSizeDecreaseExecutedEventArgs>(action),
    action,
  };
}

export const positionSizeDecreaseExecutedParser = {
  eventName,
  logParser: parsePositionSizeDecreaseExecutedEventLog,
  actionParser: parsePositionSizeDecreaseExecutedAction,
};
