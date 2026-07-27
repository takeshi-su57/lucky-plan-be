import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from '@jest/globals';

import { Platform } from 'generated/prisma/enums';

import { readSqliteCachedLogsByAddress } from './simulation-evaluator-worker-sqlite-event-log-reader';

describe('readSqliteCachedLogsByAddress', () => {
  it('loads ordered event logs for all requested addresses in batches', () => {
    const database = new DatabaseSync(':memory:');
    database.exec(`
      CREATE TABLE perp_trading_event_log (
        contract_id INTEGER NOT NULL,
        json_log TEXT NOT NULL,
        usd_pnl REAL NOT NULL,
        block INTEGER NOT NULL,
        log_index INTEGER NOT NULL,
        transaction_hash TEXT NOT NULL,
        date TEXT NOT NULL,
        address TEXT NOT NULL,
        platform TEXT NOT NULL,
        PRIMARY KEY (contract_id, block, log_index)
      ) STRICT;
      CREATE INDEX perp_trading_event_log_platform_address_date_idx
        ON perp_trading_event_log (
          platform, address, date, block, log_index, contract_id
        );
      INSERT INTO perp_trading_event_log VALUES
        (1, '{}', 1, 2, 0, '0x1', '2026-01-02T00:00:00.000Z', '0xa', 'GNS'),
        (1, '{}', 2, 1, 0, '0x2', '2026-01-01T00:00:00.000Z', '0xa', 'GNS'),
        (2, '{}', 3, 1, 0, '0x3', '2026-01-01T00:00:00.000Z', '0xb', 'GNS'),
        (3, '{}', 4, 1, 0, '0x4', '2025-12-31T00:00:00.000Z', '0xb', 'GNS');
    `);

    try {
      const recordsByAddress = readSqliteCachedLogsByAddress(database, {
        platform: Platform.GNS,
        addresses: ['0xA', '0xb', '0xmissing', '0xA'],
        startedAt: new Date('2026-01-01T00:00:00.000Z'),
        endedAt: new Date('2026-02-01T00:00:00.000Z'),
      });

      expect(
        recordsByAddress.get('0xa')?.map((record) => record.block),
      ).toEqual([1, 2]);
      expect(
        recordsByAddress.get('0xb')?.map((record) => record.block),
      ).toEqual([1]);
      expect(recordsByAddress.get('0xmissing')).toEqual([]);

      const insert = database.prepare(
        `INSERT INTO perp_trading_event_log VALUES (?, '{}', 1, 1, 0, ?,
         '2026-01-15T00:00:00.000Z', ?, 'GNS')`,
      );
      const addresses = Array.from(
        { length: 501 },
        (_, index) => `0xbatch${index}`,
      );
      for (const [index, address] of addresses.entries()) {
        insert.run(index + 100, `0xbatch${index}`, address);
      }
      const batchedRecords = readSqliteCachedLogsByAddress(database, {
        platform: Platform.GNS,
        addresses,
        startedAt: new Date('2026-01-01T00:00:00.000Z'),
        endedAt: new Date('2026-02-01T00:00:00.000Z'),
      });
      expect(batchedRecords.get('0xbatch0')).toHaveLength(1);
      expect(batchedRecords.get('0xbatch500')).toHaveLength(1);
    } finally {
      database.close();
    }
  });
});
