import { DecodeEventLogReturnType, getAbiItem } from 'viem';
import { gnsMultiCollatDiamondAbi } from 'src/microservices/web3Service/platform/gns/v9/abi/GNSMultiCollatDiamond';
import { actionToEvent, eventToAction } from 'src/utils';

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
  contractId: number,
  event: LeverageUpdateExecutedEvent,
) {
  return eventToAction(
    event.eventName,
    {
      contractId,
      address: event.args.trader,
      index: Number(event.args.index),
    },
    event.args,
  );
}

export const leverageUpdateExecutedEventParser = {
  eventName,
  logParser: parseLeverageUpdateExecutedEvent,
  actionParser: actionToEvent<LeverageUpdateExecutedEventArgs>,
};
