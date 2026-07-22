import { promises as fs } from 'fs';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'path';

import { SIMULATION_EVALUATOR } from 'src/microservices/analyticsService/modules/simulationEvaluator/simulation-evaluator.constants';

const cacheDir = join(
  process.cwd(),
  ...SIMULATION_EVALUATOR.workerCacheDirectory,
);
/**
 * Makes a manually transferred cache safe for the worker configured in .env.
 * Cache coverage and event-log files remain intact; worker-specific state does not.
 */
export async function adoptPrebuiltCache(cacheDirectory = cacheDir) {
  const databasePath = join(cacheDirectory, 'cache.sqlite');
  await fs.access(cacheDirectory);
  await fs.access(databasePath);

  const database = new DatabaseSync(databasePath);
  try {
    const tables = new Set(
      (
        database
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
          .all() as { name: string }[]
      ).map((table) => table.name),
    );
    if (
      !tables.has('platform_cache_coverage') ||
      !tables.has('address_cache_coverage')
    ) {
      throw new Error(
        'The extracted .cache/cache.sqlite is not an evaluator-worker cache',
      );
    }

    // Identity and task leases belong only to the worker that created the cache.
    if (tables.has('worker_identity')) database.exec('DELETE FROM worker_identity');
    if (tables.has('prebuild_task_checkpoint'))
      database.exec('DELETE FROM prebuild_task_checkpoint');
    database.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } finally {
    database.close();
  }

  await Promise.all([
    fs.rm(join(cacheDirectory, 'parent-session.json'), { force: true }),
    fs.rm(`${databasePath}-wal`, { force: true }),
    fs.rm(`${databasePath}-shm`, { force: true }),
  ]);
  console.log(
    '[adopt] Prebuilt cache adopted. Cache coverage and event-log files were retained; the previous worker identity and task state were removed.',
  );
}
