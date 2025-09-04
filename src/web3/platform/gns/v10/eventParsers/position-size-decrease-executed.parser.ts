import { DecodeEventLogReturnType, getAbiItem } from 'viem';
import { gnsMultiCollatDiamondAbi } from '../abi/GNSMultiCollatDiamond';
import { actionToEvent, eventToAction } from 'src/utils';
import { getGnsPositionKey } from '../../utils';

export const eventName = 'PositionSizeDecreaseExecuted';

export const abiItem = getAbiItem({
  abi: gnsMultiCollatDiamondAbi,
  name: eventName,
});

export type PositionSizeDecreaseExecutedEvent = DecodeEventLogReturnType<
  typeof gnsMultiCollatDiamondAbi,
  typeof eventName
>;
export type PositionSizeDecreaseExecutedEventArgs =
  PositionSizeDecreaseExecutedEvent['args'];

export function parsePositionSizeDecreaseExecutedEvent(
  event: PositionSizeDecreaseExecutedEvent,
) {
  return eventToAction(
    event.eventName,
    getGnsPositionKey(event.args.trader, Number(event.args.index)),
    event.args.trader,
    event.args,
  );
}

export const positionSizeDecreaseExecutedEventParser = {
  eventName,
  logParser: parsePositionSizeDecreaseExecutedEvent,
  actionParser: actionToEvent<PositionSizeDecreaseExecutedEventArgs>,
};
