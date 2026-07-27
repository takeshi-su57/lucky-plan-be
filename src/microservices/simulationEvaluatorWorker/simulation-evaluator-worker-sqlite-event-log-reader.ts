import { DatabaseSync } from 'node:sqlite';

import { Platform } from 'generated/prisma/enums';
import { WorkerCachedEventLog } from './simulation-evaluator-worker-cache.service';

export const SQLITE_EVENT_LOG_ADDRESS_BATCH_SIZE = 500;

export function readSqliteCachedLogsByAddress(
  database: DatabaseSync,
  input: {
    platform: Platform;
    addresses: string[];
    startedAt: Date;
    endedAt: Date;
  },
): Map<string, WorkerCachedEventLog[]> {
  const addresses = [
    ...new Set(input.addresses.map((address) => address.toLowerCase())),
  ];
  const recordsByAddress = new Map<string, WorkerCachedEventLog[]>(
    addresses.map((address) => [address, []]),
  );

  for (
    let offset = 0;
    offset < addresses.length;
    offset += SQLITE_EVENT_LOG_ADDRESS_BATCH_SIZE
  ) {
    const addressBatch = addresses.slice(
      offset,
      offset + SQLITE_EVENT_LOG_ADDRESS_BATCH_SIZE,
    );
    const placeholders = addressBatch.map(() => '?').join(', ');
    const rows = database
      .prepare(
        `SELECT address, date, block, log_index, contract_id, platform,
                transaction_hash, json_log, usd_pnl
         FROM perp_trading_event_log
         WHERE platform = ? AND address IN (${placeholders})
           AND date >= ? AND date < ?
         ORDER BY address, date, block, log_index, contract_id`,
      )
      .all(
        input.platform,
        ...addressBatch,
        input.startedAt.toISOString(),
        input.endedAt.toISOString(),
      ) as SqliteEventLogRow[];

    for (const row of rows) {
      const address = row.address.toLowerCase();
      const records = recordsByAddress.get(address);
      if (!records) continue;
      records.push({
        address: row.address,
        date: row.date,
        block: row.block,
        logIndex: row.log_index,
        contractId: row.contract_id,
        platform: row.platform,
        transactionHash: row.transaction_hash,
        jsonLog: row.json_log,
        usdPnl: row.usd_pnl,
      });
    }
  }

  return recordsByAddress;
}

type SqliteEventLogRow = {
  address: string;
  date: string;
  block: number;
  log_index: number;
  contract_id: number;
  platform: Platform;
  transaction_hash: string;
  json_log: string;
  usd_pnl: number;
};
