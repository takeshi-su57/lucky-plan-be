import { DecodeEventLogReturnType, getAbiItem } from 'viem';
import { gnsMultiCollatDiamondAbi } from '../abi/GNSMultiCollatDiamond';
import { actionToEvent, eventToAction } from 'src/utils';
import { getGnsPositionKey } from '../../utils';

export const eventName = 'MarketExecuted';

export const abiItem = getAbiItem({
  abi: gnsMultiCollatDiamondAbi,
  name: eventName,
});

export type MarketExecutedEvent = DecodeEventLogReturnType<
  typeof gnsMultiCollatDiamondAbi,
  typeof eventName
>;
export type MarketExecutedEventArgs = MarketExecutedEvent['args'];

export function parseMarketExecutedEvent(event: MarketExecutedEvent) {
  return eventToAction(
    event.eventName,
    getGnsPositionKey(event.args.t.user, event.args.t.index),
    event.args.t.user,
    event.args,
  );
}

export const marketExecutedEventParser = {
  eventName,
  logParser: parseMarketExecutedEvent,
  actionParser: actionToEvent<
    MarketExecutedEventArgs & { isManualOpen?: boolean }
  >,
};
