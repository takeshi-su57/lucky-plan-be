import { DecodeEventLogReturnType, getAbiItem } from 'viem';
import { gnsMultiCollatDiamondAbi } from 'src/abi/GNSMultiCollatDiamond';
import { actionToEvent, eventToAction } from 'src/utils';

export const eventName = 'LeverageUpdateInitiated';

export const abiItem = getAbiItem({
  abi: gnsMultiCollatDiamondAbi,
  name: eventName,
});

export type LeverageUpdateInitiatedEvent = DecodeEventLogReturnType<
  typeof gnsMultiCollatDiamondAbi,
  typeof eventName
>;
export type LeverageUpdateInitiatedEventArgs =
  LeverageUpdateInitiatedEvent['args'];

export function parseLeverageUpdateInitiatedEvent(
  event: LeverageUpdateInitiatedEvent,
) {
  return eventToAction(
    event.eventName,
    {
      address: event.args.orderId.user,
      index: event.args.orderId.index,
    },
    event.args,
  );
}

export const leverageUpdateInitiatedEventParser = {
  eventName,
  logParser: parseLeverageUpdateInitiatedEvent,
  actionParser: actionToEvent<LeverageUpdateInitiatedEventArgs>,
};
