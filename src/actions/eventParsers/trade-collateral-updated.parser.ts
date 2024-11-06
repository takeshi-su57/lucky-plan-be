import { AbiEvent, decodeEventLog, getAbiItem, GetLogsReturnType } from 'viem';
import { gnsMultiCollatDiamondAbi } from 'src/abi/GNSMultiCollatDiamond';
import { actionToEvent, eventToAction } from 'src/utils';
import { ActionItem } from '../entities/action.entity';

export const eventName = 'TradeCollateralUpdated';

const abiItem = getAbiItem({
  abi: gnsMultiCollatDiamondAbi,
  name: eventName,
});

export type TradeCollateralUpdatedEvent = typeof abiItem;
export type TradeCollateralUpdatedEventArgs = typeof abiItem.inputs;

export function parseTradeCollateralUpdatedEventLog(
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
        address: event.args.user,
        index: event.args.index,
      },
      event.args,
    ),
  };
}

export function parseTradeCollateralUpdatedAction(action: ActionItem) {
  return {
    event: actionToEvent<TradeCollateralUpdatedEventArgs>(action),
    action,
  };
}

export const tradeCollateralUpdatedParser = {
  eventName,
  logParser: parseTradeCollateralUpdatedEventLog,
  actionParser: parseTradeCollateralUpdatedAction,
};
