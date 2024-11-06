import { AbiEvent, decodeEventLog, getAbiItem, GetLogsReturnType } from 'viem';
import { gnsMultiCollatDiamondAbi } from 'src/abi/GNSMultiCollatDiamond';
import { actionToEvent, eventToAction } from 'src/utils';
import { ActionItem } from '../entities/action.entity';

export const eventName = 'MarketOpenCanceled';

const abiItem = getAbiItem({
  abi: gnsMultiCollatDiamondAbi,
  name: eventName,
});

export type MarketOpenCanceledEvent = typeof abiItem;
export type MarketOpenCanceledEventArgs = typeof abiItem.inputs;

export function parseMarketOpenCanceledEventLog(
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

export function parseMarketOpenCanceledAction(action: ActionItem) {
  return {
    event: actionToEvent<MarketOpenCanceledEventArgs>(action),
    action,
  };
}

export const marketOpenCanceledParser = {
  eventName,
  logParser: parseMarketOpenCanceledEventLog,
  actionParser: parseMarketOpenCanceledAction,
};
