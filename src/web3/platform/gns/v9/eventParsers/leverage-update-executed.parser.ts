import { DecodeEventLogReturnType, getAbiItem } from 'viem';
import { gnsMultiCollatDiamondAbi } from '../abi/GNSMultiCollatDiamond';
import { actionToEvent, eventToAction } from 'src/utils';
import { getGnsPositionKey } from '../../utils';

export const eventName = 'LeverageUpdateExecuted';

export const abiItem = getAbiItem({
  abi: gnsMultiCollatDiamondAbi,
  name: eventName,
});

export type LeverageUpdateExecutedEvent = DecodeEventLogReturnType<
  typeof gnsMultiCollatDiamondAbi,
  typeof eventName
>;
export type LeverageUpdateExecutedEventArgs =
  LeverageUpdateExecutedEvent['args'];

export function parseLeverageUpdateExecutedEvent(
  event: LeverageUpdateExecutedEvent,
) {
  return eventToAction(
    event.eventName,
    getGnsPositionKey(event.args.trader, Number(event.args.index)),
    event.args.trader,
    event.args,
  );
}

export const leverageUpdateExecutedEventParser = {
  eventName,
  logParser: parseLeverageUpdateExecutedEvent,
  actionParser: actionToEvent<LeverageUpdateExecutedEventArgs>,
};
