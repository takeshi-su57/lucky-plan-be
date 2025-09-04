import { DecodeEventLogReturnType, getAbiItem } from 'viem';
import { gnsMultiCollatDiamondAbi } from '../abi/GNSMultiCollatDiamond';
import { actionToEvent, eventToAction } from 'src/utils';
import { getGnsPositionKey } from '../../utils';

export const eventName = 'PositionSizeIncreaseExecuted';

export const abiItem = getAbiItem({
  abi: gnsMultiCollatDiamondAbi,
  name: eventName,
});

export type PositionSizeIncreaseExecutedEvent = DecodeEventLogReturnType<
  typeof gnsMultiCollatDiamondAbi,
  typeof eventName
>;
export type PositionSizeIncreaseExecutedEventArgs =
  PositionSizeIncreaseExecutedEvent['args'];

export function parsePositionSizeIncreaseExecutedEvent(
  event: PositionSizeIncreaseExecutedEvent,
) {
  return eventToAction(
    event.eventName,
    getGnsPositionKey(event.args.trader, Number(event.args.index)),
    event.args.trader,
    event.args,
  );
}

export const positionSizeIncreaseExecutedEventParser = {
  eventName,
  logParser: parsePositionSizeIncreaseExecutedEvent,
  actionParser: actionToEvent<PositionSizeIncreaseExecutedEventArgs>,
};
