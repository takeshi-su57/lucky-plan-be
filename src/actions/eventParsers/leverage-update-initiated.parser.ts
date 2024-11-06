import { AbiEvent, decodeEventLog, getAbiItem, GetLogsReturnType } from 'viem';
import { gnsMultiCollatDiamondAbi } from 'src/abi/GNSMultiCollatDiamond';
import { actionToEvent, eventToAction } from 'src/utils';
import { ActionItem } from '../entities/action.entity';

export const eventName = 'LeverageUpdateInitiated';

const abiItem = getAbiItem({
  abi: gnsMultiCollatDiamondAbi,
  name: eventName,
});

export type LeverageUpdateInitiatedEvent = typeof abiItem;
export type LeverageUpdateInitiatedEventArgs = typeof abiItem.inputs;

export function parseLeverageUpdateInitiatedEventLog(
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

export function parseLeverageUpdateInitiatedAction(action: ActionItem) {
  return {
    event: actionToEvent<LeverageUpdateInitiatedEventArgs>(action),
    action,
  };
}

export const leverageUpdateInitiatedParser = {
  eventName,
  logParser: parseLeverageUpdateInitiatedEventLog,
  actionParser: parseLeverageUpdateInitiatedAction,
};
