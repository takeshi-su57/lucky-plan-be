import { AbiEvent, decodeEventLog, getAbiItem, GetLogsReturnType } from 'viem';
import { gnsMultiCollatDiamondAbi } from 'src/abi/GNSMultiCollatDiamond';
import { actionToEvent, eventToAction } from 'src/utils';
import { ActionItem } from '../entities/action.entity';

export const eventName = 'PositionSizeUpdateInitiated';

const abiItem = getAbiItem({
  abi: gnsMultiCollatDiamondAbi,
  name: eventName,
});

export type PositionSizeUpdateInitiatedEvent = typeof abiItem;
export type PositionSizeUpdateInitiatedEventArgs = typeof abiItem.inputs;

export function parsePositionSizeUpdateInitiatedEventLog(
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

export function parsePositionSizeUpdateInitiatedAction(action: ActionItem) {
  return {
    event: actionToEvent<PositionSizeUpdateInitiatedEventArgs>(action),
    action,
  };
}

export const positionSizeUpdateInitiatedParser = {
  eventName,
  logParser: parsePositionSizeUpdateInitiatedEventLog,
  actionParser: parsePositionSizeUpdateInitiatedAction,
};
