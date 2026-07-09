import { describe, expect, it } from '@jest/globals';

import {
  compareEventLogOrder,
  getEventLogCursorWhere,
  getEventLogOrderBy,
  getEventLogStableId,
  getEventLogSourceKey,
} from './event-log-identity.utils';

describe('event log identity utils', () => {
  it('builds stable ids and source keys from the composite event identity', () => {
    const log = { contractId: 12, block: 100, logIndex: 2 };

    expect(getEventLogSourceKey(log)).toBe('12:100:2');
    expect(getEventLogStableId(log)).toBe(1000022);
  });

  it('orders event logs by date, block, log index, and contract id', () => {
    const records = [
      {
        date: new Date('2026-05-01T00:00:00.000Z'),
        block: 100,
        contractId: 12,
        logIndex: 2,
      },
      {
        date: new Date('2026-05-01T00:00:00.000Z'),
        block: 100,
        contractId: 11,
        logIndex: 3,
      },
      {
        date: new Date('2026-05-01T00:00:00.000Z'),
        block: 99,
        contractId: 99,
        logIndex: 9,
      },
    ];

    expect([...records].sort(compareEventLogOrder)).toEqual([
      records[2],
      records[0],
      records[1],
    ]);
  });

  it('builds Prisma order and seek filters without scalar id', () => {
    expect(getEventLogOrderBy()).toEqual([
      { date: 'asc' },
      { block: 'asc' },
      { logIndex: 'asc' },
      { contractId: 'asc' },
    ]);
    expect(
      getEventLogCursorWhere({
        date: new Date('2026-05-01T00:00:00.000Z'),
        block: 100,
        contractId: 12,
        logIndex: 2,
      }),
    ).toEqual({
      OR: [
        { date: { gt: new Date('2026-05-01T00:00:00.000Z') } },
        {
          date: new Date('2026-05-01T00:00:00.000Z'),
          block: { gt: 100 },
        },
        {
          date: new Date('2026-05-01T00:00:00.000Z'),
          block: 100,
          logIndex: { gt: 2 },
        },
        {
          date: new Date('2026-05-01T00:00:00.000Z'),
          block: 100,
          logIndex: 2,
          contractId: { gt: 12 },
        },
      ],
    });
  });
});
