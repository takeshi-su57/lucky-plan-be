import {
  ActionItem,
  Action,
} from 'src/microservices/apiService/modules/actions/entities/action.entity';
import { PositionInfo } from 'src/microservices/apiService/modules/positions/entities/position.entity';
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

export function bigIntSafeJsonStringify(obj: unknown) {
  return JSON.stringify(obj, (_, v) =>
    typeof v === 'bigint' ? { isBigInt: true, value: v.toString() } : v,
  );
}

export function bigIntSafeJsonParse<T>(json: string): T {
  const obj = JSON.parse(json);

  const safeObj = (obj: unknown): unknown => {
    if (Array.isArray(obj)) {
      return obj.map((item: unknown) => {
        if (typeof item === 'object' && item !== null) {
          if ('isBigInt' in item && 'value' in item && item.isBigInt) {
            return BigInt(item.value as string);
          }

          return safeObj(item);
        }

        return item;
      });
    } else if (typeof obj === 'object' && obj !== null) {
      if ('isBigInt' in obj && 'value' in obj && obj.isBigInt) {
        return BigInt(obj.value as string);
      }

      return Object.fromEntries(
        Object.entries(obj).map(([key, value]) => [key, safeObj(value)]),
      );
    }

    return obj;
  };

  return safeObj(obj) as T;
}
