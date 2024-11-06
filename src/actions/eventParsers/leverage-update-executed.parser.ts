import { AbiEvent, decodeEventLog, getAbiItem, GetLogsReturnType } from 'viem';
import { gnsMultiCollatDiamondAbi } from 'src/abi/GNSMultiCollatDiamond';
import { actionToEvent, eventToAction } from 'src/utils';
import { ActionItem } from '../entities/action.entity';

export const eventName = 'LeverageUpdateExecuted';

const abiItem = getAbiItem({
  abi: gnsMultiCollatDiamondAbi,
  name: eventName,
});

export type LeverageUpdateExecutedEvent = typeof abiItem;
export type LeverageUpdateExecutedEventArgs = typeof abiItem.inputs;

export function parseLeverageUpdateExecutedEventLog(
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

export function parseLeverageUpdateExecutedAction(action: ActionItem) {
  return {
    event: actionToEvent<LeverageUpdateExecutedEventArgs>(action),
    action,
  };
}

export const leverageUpdateExecutedParser = {
  eventName,
  logParser: parseLeverageUpdateExecutedEventLog,
  actionParser: parseLeverageUpdateExecutedAction,
};
