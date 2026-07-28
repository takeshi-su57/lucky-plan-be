import { GmxV1LogEnvelope } from './types';
import { toBigInt } from './utils';

const PRIMARY_EVENT_NAMES = new Set([
  'IncreasePosition',
  'DecreasePosition',
  'LiquidatePosition',
]);

function getTransactionKey(log: GmxV1LogEnvelope): string {
  const transactionHash = log.transactionHash || log.txHash;

  return transactionHash || `${log.blockNumber}-${log.logIndex}`;
}

function keysMatch(left: unknown, right: unknown): boolean {
  return String(left).toLowerCase() === String(right).toLowerCase();
}

function findPreviousCompanion<T extends GmxV1LogEnvelope>(
  logs: T[],
  startIndex: number,
  usedIndexes: Set<number>,
  predicate: (log: T) => boolean,
): number | undefined {
  for (let index = startIndex - 1; index >= 0; index--) {
    if (PRIMARY_EVENT_NAMES.has(logs[index].eventLog.eventName)) {
      break;
    }

    if (!usedIndexes.has(index) && predicate(logs[index])) {
      return index;
    }
  }

  return undefined;
}

function findNextCompanion<T extends GmxV1LogEnvelope>(
  logs: T[],
  startIndex: number,
  usedIndexes: Set<number>,
  predicate: (log: T) => boolean,
): number | undefined {
  for (let index = startIndex + 1; index < logs.length; index++) {
    if (PRIMARY_EVENT_NAMES.has(logs[index].eventLog.eventName)) {
      break;
    }

    if (!usedIndexes.has(index) && predicate(logs[index])) {
      return index;
    }
  }

  return undefined;
}

function normalizeTransaction<T extends GmxV1LogEnvelope>(logs: T[]): T[] {
  const sortedLogs = [...logs].sort(
    (left, right) => left.logIndex - right.logIndex,
  );
  const usedIndexes = new Set<number>();
  const normalizedLogs: T[] = [];

  sortedLogs.forEach((log, index) => {
    const { eventName, args } = log.eventLog;

    if (!PRIMARY_EVENT_NAMES.has(eventName)) {
      return;
    }

    const marginFeeIndex = findPreviousCompanion(
      sortedLogs,
      index,
      usedIndexes,
      (candidate) =>
        candidate.eventLog.eventName === 'CollectMarginFees' &&
        keysMatch(candidate.eventLog.args.token, args.collateralToken),
    );
    const marginFeeArgs =
      marginFeeIndex === undefined
        ? undefined
        : sortedLogs[marginFeeIndex].eventLog.args;

    if (marginFeeIndex !== undefined) {
      usedIndexes.add(marginFeeIndex);
    }

    if (eventName === 'LiquidatePosition') {
      const liquidationCollateral = toBigInt(args.collateral);
      const feeUsd = toBigInt(marginFeeArgs?.feeUsd);
      const basePnlUsd = -(liquidationCollateral > feeUsd
        ? liquidationCollateral - feeUsd
        : 0n);

      normalizedLogs.push({
        ...log,
        eventLog: {
          eventName,
          args: {
            ...args,
            positionKey: args.key,
            collateralDelta: 0n,
            sizeDelta: toBigInt(args.size),
            price: args.markPrice,
            executionPrice: args.markPrice,
            fee: feeUsd,
            feeUsd,
            sizeInUsd: 0n,
            collateralInUsd: 0n,
            basePnlUsd,
            averagePrice: 0n,
            entryFundingRate: 0n,
            markPrice: args.markPrice,
            liquidationCollateral,
          },
        },
      } as T);
      return;
    }

    const stateIndex = findNextCompanion(
      sortedLogs,
      index,
      usedIndexes,
      (candidate) =>
        (candidate.eventLog.eventName === 'UpdatePosition' ||
          candidate.eventLog.eventName === 'ClosePosition') &&
        keysMatch(candidate.eventLog.args.key, args.key),
    );
    const stateLog =
      stateIndex === undefined ? undefined : sortedLogs[stateIndex].eventLog;

    if (stateIndex !== undefined) {
      usedIndexes.add(stateIndex);
    }

    const isClosed = stateLog?.eventName === 'ClosePosition';
    const sizeInUsd = isClosed
      ? 0n
      : toBigInt(stateLog?.args.size, toBigInt(args.sizeDelta));
    const fallbackCollateral = (() => {
      const collateralDelta = toBigInt(args.collateralDelta);
      const fee = toBigInt(marginFeeArgs?.feeUsd, toBigInt(args.fee));

      return collateralDelta > fee ? collateralDelta - fee : 0n;
    })();
    const collateralInUsd = isClosed
      ? 0n
      : toBigInt(stateLog?.args.collateral, fallbackCollateral);

    const pnlIndex =
      eventName === 'DecreasePosition'
        ? findPreviousCompanion(
            sortedLogs,
            index,
            usedIndexes,
            (candidate) =>
              candidate.eventLog.eventName === 'UpdatePnl' &&
              keysMatch(candidate.eventLog.args.key, args.key),
          )
        : undefined;
    const pnlArgs =
      pnlIndex === undefined ? undefined : sortedLogs[pnlIndex].eventLog.args;

    if (pnlIndex !== undefined) {
      usedIndexes.add(pnlIndex);
    }

    const pnlDelta = toBigInt(pnlArgs?.delta);
    const basePnlUsd = pnlArgs?.hasProfit === false ? -pnlDelta : pnlDelta;
    const feeUsd = toBigInt(marginFeeArgs?.feeUsd, toBigInt(args.fee));

    normalizedLogs.push({
      ...log,
      eventLog: {
        eventName,
        args: {
          ...args,
          positionKey: args.key,
          executionPrice: args.price,
          feeUsd,
          sizeInUsd,
          collateralInUsd,
          basePnlUsd,
          averagePrice: toBigInt(stateLog?.args.averagePrice),
          entryFundingRate: toBigInt(stateLog?.args.entryFundingRate),
          reserveAmount: toBigInt(stateLog?.args.reserveAmount),
          realisedPnl: toBigInt(stateLog?.args.realisedPnl),
          markPrice: toBigInt(stateLog?.args.markPrice, toBigInt(args.price)),
          stateEventName: stateLog?.eventName,
        },
      },
    } as T);
  });

  return normalizedLogs;
}

/**
 * GMX V1 position state is spread across multiple Vault logs in one transaction.
 * This function emits one enriched log per primary position operation and drops
 * the companion logs after merging their data into the primary event.
 */
export function normalizeGmxV1EventLogs<T extends GmxV1LogEnvelope>(
  logs: T[],
): T[] {
  const groups = new Map<string, T[]>();

  for (const log of logs) {
    const key = getTransactionKey(log);
    const group = groups.get(key);

    if (group) {
      group.push(log);
    } else {
      groups.set(key, [log]);
    }
  }

  return Array.from(groups.values())
    .flatMap((group) => normalizeTransaction(group))
    .sort((left, right) => {
      if (left.blockNumber === right.blockNumber) {
        return left.logIndex - right.logIndex;
      }

      return left.blockNumber - right.blockNumber;
    });
}
