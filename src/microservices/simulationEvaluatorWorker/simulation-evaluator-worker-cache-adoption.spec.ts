import { DatabaseSync } from 'node:sqlite';
import { access, mkdtemp, rm, writeFile } from 'fs/promises';
import { describe, expect, it } from '@jest/globals';
import { tmpdir } from 'os';
import { join } from 'path';

import { adoptPrebuiltCache } from './simulation-evaluator-worker-cache-adoption';

describe('adoptPrebuiltCache', () => {
  it('retains cache coverage and removes source-worker state', async () => {
    const cacheDirectory = await mkdtemp(join(tmpdir(), 'evaluator-cache-'));
    const databasePath = join(cacheDirectory, 'cache.sqlite');
    const database = new DatabaseSync(databasePath);
    database.exec(`
      CREATE TABLE platform_cache_coverage (platform TEXT, started_at TEXT, ended_at TEXT);
      CREATE TABLE address_cache_coverage (platform TEXT, address TEXT, started_at TEXT, ended_at TEXT);
      CREATE TABLE worker_identity (id INTEGER);
      CREATE TABLE prebuild_task_checkpoint (task_id TEXT);
      INSERT INTO platform_cache_coverage VALUES ('gains', '2026-01-01', '2026-01-02');
      INSERT INTO address_cache_coverage VALUES ('gains', '0x1', '2026-01-01', '2026-01-02');
      INSERT INTO worker_identity VALUES (1);
      INSERT INTO prebuild_task_checkpoint VALUES ('source-task');
    `);
    database.close();
    await writeFile(join(cacheDirectory, 'parent-session.json'), '{}');

    try {
      await adoptPrebuiltCache(cacheDirectory);

      const adopted = new DatabaseSync(databasePath);
      expect(
        adopted
          .prepare('SELECT COUNT(*) AS count FROM platform_cache_coverage')
          .get(),
      ).toEqual({ count: 1 });
      expect(
        adopted
          .prepare('SELECT COUNT(*) AS count FROM address_cache_coverage')
          .get(),
      ).toEqual({ count: 1 });
      expect(
        adopted
          .prepare('SELECT COUNT(*) AS count FROM worker_identity')
          .get(),
      ).toEqual({ count: 0 });
      expect(
        adopted
          .prepare('SELECT COUNT(*) AS count FROM prebuild_task_checkpoint')
          .get(),
      ).toEqual({ count: 0 });
      adopted.close();
      await expect(access(join(cacheDirectory, 'parent-session.json'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    } finally {
      await rm(cacheDirectory, { recursive: true, force: true });
    }
  });
});
