import { ActionItem, Action } from 'src/actions/entities/action.entity';
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

export function actionToEvent<T>(action: Action | ActionItem): TradeEvent<T> {
  return {
    eventName: action.name,
    args: JSON.parse(action.args) as T,
  };
}

export function getReadableError(error: unknown) {
  if (error instanceof Error) {
    return error.message; // Standard error object
  }
  if (typeof error === 'object') {
    return JSON.stringify(error); // Non-standard object
  }
  return String(error); // Other types (e.g., string, number)
}

export function getStartOfDay(date: Date): Date {
  const updatedDate = new Date(date);
  updatedDate.setHours(0, 0, 0, 0);
  return updatedDate;
}

export function getStartOfWeek(date: Date): Date {
  const updatedDate = new Date(date);
  updatedDate.setDate(updatedDate.getDate() - updatedDate.getDay());
  return getStartOfDay(updatedDate);
}

export function getStartOfMonth(date: Date): Date {
  const updatedDate = new Date(date);
  updatedDate.setDate(1);
  return getStartOfDay(updatedDate);
}

export async function delay(ms: number) {
  const promise = new Promise((resolve) => setTimeout(resolve, ms));

  await promise;
}
