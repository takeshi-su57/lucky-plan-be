import { DecodeEventLogReturnType, getAbiItem } from 'viem';
import { gnsMultiCollatDiamondAbi } from '../abi/GNSMultiCollatDiamond';
import { actionToEvent, eventToAction } from 'src/utils';
import { getGnsPositionKey } from '../../utils';

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

export function parseLimitExecutedEvent(event: LimitExecutedEvent) {
  return eventToAction(
    event.eventName,
    getGnsPositionKey(event.args.t.user, event.args.t.index),
    event.args.t.user,
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
