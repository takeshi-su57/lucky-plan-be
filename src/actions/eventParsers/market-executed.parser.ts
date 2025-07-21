import { DecodeEventLogReturnType, getAbiItem } from 'viem';
import { gnsMultiCollatDiamondAbi } from 'src/abi/GNSMultiCollatDiamond';
import { actionToEvent, eventToAction } from 'src/utils';

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

export function parseMarketExecutedEvent(
  contractId: number,
  event: MarketExecutedEvent,
) {
  return eventToAction(
    event.eventName,
    {
      contractId,
      address: event.args.t.user,
      index: event.args.t.index,
    },
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
