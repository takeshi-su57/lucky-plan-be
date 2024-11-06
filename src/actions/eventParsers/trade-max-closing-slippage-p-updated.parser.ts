import { AbiEvent, decodeEventLog, getAbiItem, GetLogsReturnType } from 'viem';
import { gnsMultiCollatDiamondAbi } from 'src/abi/GNSMultiCollatDiamond';
import { actionToEvent, eventToAction } from 'src/utils';
import { ActionItem } from '../entities/action.entity';

export const eventName = 'TradeMaxClosingSlippagePUpdated';

const abiItem = getAbiItem({
  abi: gnsMultiCollatDiamondAbi,
  name: eventName,
});

export type TradeMaxClosingSlippagePUpdatedEvent = typeof abiItem;
export type TradeMaxClosingSlippagePUpdatedEventArgs = typeof abiItem.inputs;

export function parseTradeMaxClosingSlippagePUpdatedEventLog(
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

export function parseTradeMaxClosingSlippagePUpdatedAction(action: ActionItem) {
  return {
    event: actionToEvent<TradeMaxClosingSlippagePUpdatedEventArgs>(action),
    action,
  };
}

export const tradeMaxClosingSlippagePUpdatedParser = {
  eventName,
  logParser: parseTradeMaxClosingSlippagePUpdatedEventLog,
  actionParser: parseTradeMaxClosingSlippagePUpdatedAction,
};
