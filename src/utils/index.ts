import { ActionItem } from 'src/actions/entities/action.entity';
import { PositionInfo } from 'src/positions/entities/position.entity';
import { TradeEvent } from 'src/types';

export function eventToAction(
  eventName: string,
  position: PositionInfo,
  args: unknown,
): ActionItem {
  return {
    name: eventName,
    position,
    args: JSON.stringify(args, (_, v) =>
      typeof v === 'bigint' ? v.toString() : v,
    ),
  };
}

export function actionToEvent<T>(action: ActionItem): TradeEvent<T> {
  return {
    eventName: action.name,
    args: JSON.parse(action.args) as T,
  };
}
