import { DecodeEventLogReturnType, getAbiItem } from 'viem';
import { gnsMultiCollatDiamondAbi } from 'src/abi/GNSMultiCollatDiamond';
import { actionToEvent, eventToAction } from 'src/utils';

export const eventName = 'LimitExecuted';

export const abiItem = getAbiItem({
  abi: gnsMultiCollatDiamondAbi,
  name: eventName,
});

export type LimitExecutedEvent = DecodeEventLogReturnType<
  typeof gnsMultiCollatDiamondAbi,
  typeof eventName
>;
export type LimitExecutedEventArgs = LimitExecutedEvent['args'];

export function parseLimitExecutedEvent(
  contractId: number,
  event: LimitExecutedEvent,
) {
  return eventToAction(
    event.eventName,
    { contractId, address: event.args.t.user, index: event.args.t.index },
    event.args,
  );
}

export const limitExecutedEventParser = {
  eventName,
  logParser: parseLimitExecutedEvent,
  actionParser: actionToEvent<
    LimitExecutedEventArgs & { isManualOpen?: boolean }
  >,
};
