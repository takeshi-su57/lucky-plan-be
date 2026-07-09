export type EventLogIdentity = {
  contractId: number;
  block: number;
  logIndex: number;
};

export type EventLogOrderCursor = EventLogIdentity & {
  date: Date;
};

export function getEventLogSourceKey(log: EventLogIdentity) {
  return `${log.contractId}:${log.block}:${log.logIndex}`;
}

export function getEventLogStableId(log: EventLogIdentity) {
  return (
    (log.block % 100_000) * 10_000 +
    (log.logIndex % 1_000) * 10 +
    (log.contractId % 10)
  );
}

export function getEventLogOrderBy() {
  return [
    { date: 'asc' as const },
    { block: 'asc' as const },
    { logIndex: 'asc' as const },
    { contractId: 'asc' as const },
  ];
}

export function getEventLogCursorWhere(cursor: EventLogOrderCursor) {
  return {
    OR: [
      { date: { gt: cursor.date } },
      {
        date: cursor.date,
        block: { gt: cursor.block },
      },
      {
        date: cursor.date,
        block: cursor.block,
        logIndex: { gt: cursor.logIndex },
      },
      {
        date: cursor.date,
        block: cursor.block,
        logIndex: cursor.logIndex,
        contractId: { gt: cursor.contractId },
      },
    ],
  };
}

export function compareEventLogOrder<T extends EventLogOrderCursor>(
  a: T,
  b: T,
) {
  const dateDiff = a.date.getTime() - b.date.getTime();

  if (dateDiff !== 0) {
    return dateDiff;
  }

  const blockDiff = a.block - b.block;

  if (blockDiff !== 0) {
    return blockDiff;
  }

  const logIndexDiff = a.logIndex - b.logIndex;

  return logIndexDiff !== 0 ? logIndexDiff : a.contractId - b.contractId;
}
