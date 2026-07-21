import { ZipArchive } from 'archiver';
import { createHash } from 'crypto';
import { createReadStream, createWriteStream, promises as fs } from 'fs';
import { DatabaseSync } from 'node:sqlite';
import { dirname, join, relative } from 'path';
import unzipper from 'unzipper';

import { SIMULATION_EVALUATOR } from 'src/microservices/analyticsService/modules/simulationEvaluator/simulation-evaluator.constants';

type Coverage = { platform: string; startedAt: string; endedAt: string };
type AddressCoverage = Coverage & { address: string };
type SnapshotManifest = {
  version: 1;
  createdAt: string;
  files: { path: string; sha256: string; bytes: number }[];
  platformCoverage: Coverage[];
  addressCoverage: AddressCoverage[];
};

const cacheDir = join(
  process.cwd(),
  ...SIMULATION_EVALUATOR.workerCacheDirectory,
);
const sessionPath = join(cacheDir, 'parent-session.json');

export async function exportCacheSnapshot(output: string) {
  const startedAt = Date.now();
  console.log('[cache-export] Checking evaluator state...');
  await assertNoActiveParentSession();
  await fs.mkdir(cacheDir, { recursive: true });
  console.log('[cache-export] Discovering cached event-log files...');
  const files = await listCacheFiles(cacheDir);
  console.log(
    `[cache-export] Found ${files.length.toLocaleString()} files. Calculating checksums...`,
  );
  const snapshotFiles: SnapshotManifest['files'] = [];
  for (const [index, path] of files.entries()) {
    snapshotFiles.push({
      path: relative(cacheDir, path).replaceAll('\\', '/'),
      sha256: await checksum(path),
      bytes: (await fs.stat(path)).size,
    });
    if ((index + 1) % 100 === 0 || index + 1 === files.length) {
      console.log(
        `[cache-export] Checksummed ${(index + 1).toLocaleString()}/${files.length.toLocaleString()} files.`,
      );
    }
  }
  const manifest: SnapshotManifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    files: snapshotFiles,
    ...readCoverage(),
  };
  await fs.mkdir(dirname(output), { recursive: true });
  console.log(`[cache-export] Compressing cache into ${output}...`);
  await new Promise<void>((resolve, reject) => {
    const archive = new ZipArchive({ zlib: { level: 9 } });
    const destination = createWriteStream(output);
    archive.on('error', reject);
    destination.on('error', reject);
    destination.on('close', () => {
      console.log(
        `[cache-export] Complete in ${Math.floor((Date.now() - startedAt) / 1000)}s; ${archive.pointer().toLocaleString()} bytes written.`,
      );
      resolve();
    });
    let lastProgressAt = 0;
    archive.on('progress', (progress) => {
      if (Date.now() - lastProgressAt < 1_000) return;
      lastProgressAt = Date.now();
      console.log(
        `[cache-export] Archived ${progress.entries.processed.toLocaleString()}/${progress.entries.total.toLocaleString()} files.`,
      );
    });
    archive.pipe(destination);
    archive.append(JSON.stringify(manifest, null, 2), {
      name: 'manifest.json',
    });
    for (const file of files) {
      archive.file(file, {
        name: `event-log-cache/${relative(cacheDir, file).replaceAll('\\', '/')}`,
      });
    }
    void archive.finalize();
  });
}

export async function importCacheSnapshot(input: string) {
  const startedAt = Date.now();
  console.log('[cache-import] Checking evaluator state and opening archive...');
  await assertNoActiveParentSession();
  await fs.mkdir(cacheDir, { recursive: true });
  const zip = await unzipper.Open.file(input);
  const manifestEntry = zip.files.find(
    (entry) => entry.path === 'manifest.json',
  );
  if (!manifestEntry) throw new Error('Cache snapshot has no manifest');
  const manifest = JSON.parse(
    (await manifestEntry.buffer()).toString('utf8'),
  ) as SnapshotManifest;
  if (manifest.version !== 1 || !Array.isArray(manifest.files)) {
    throw new Error('Unsupported cache snapshot format');
  }
  console.log(
    `[cache-import] Restoring ${manifest.files.length.toLocaleString()} files...`,
  );
  for (const [index, file] of manifest.files.entries()) {
    if (!isSafeCachePath(file.path))
      throw new Error(`Invalid cache path: ${file.path}`);
    const entry = zip.files.find(
      (item) => item.path === `event-log-cache/${file.path}`,
    );
    if (!entry) throw new Error(`Cache snapshot is missing ${file.path}`);
    const target = join(cacheDir, file.path);
    const temporary = `${target}.importing`;
    await fs.mkdir(dirname(target), { recursive: true });
    await pipelineEntry(entry.stream(), temporary);
    const actualChecksum = await checksum(temporary);
    if (actualChecksum !== file.sha256) {
      await fs.rm(temporary, { force: true });
      throw new Error(`Checksum mismatch for ${file.path}`);
    }
    await fs.rename(temporary, target);
    if ((index + 1) % 100 === 0 || index + 1 === manifest.files.length) {
      console.log(
        `[cache-import] Restored ${(index + 1).toLocaleString()}/${manifest.files.length.toLocaleString()} files.`,
      );
    }
  }
  writeCoverage(
    manifest.platformCoverage || [],
    manifest.addressCoverage || [],
  );
  console.log(
    `[cache-import] Complete in ${Math.floor((Date.now() - startedAt) / 1000)}s.`,
  );
}

async function assertNoActiveParentSession() {
  try {
    const session = JSON.parse(await fs.readFile(sessionPath, 'utf8')) as {
      updatedAt?: number;
    };
    if (
      typeof session.updatedAt === 'number' &&
      Date.now() - session.updatedAt <
        SIMULATION_EVALUATOR.parentSessionTimeoutMs
    ) {
      throw new Error(
        'Stop or pause the evaluator parent before exporting or importing cache',
      );
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('Stop or pause'))
      throw error;
  }
}

async function listCacheFiles(directory: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const nested = await Promise.all(
      entries.map(async (entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return listCacheFiles(path);
        return entry.name === 'eventLog.json' ? [path] : [];
      }),
    );
    return nested.flat();
  } catch {
    return [];
  }
}

function readCoverage() {
  const database = new DatabaseSync(join(cacheDir, 'cache.sqlite'));
  try {
    database.exec(
      'CREATE TABLE IF NOT EXISTS platform_cache_coverage (platform TEXT NOT NULL, started_at TEXT NOT NULL, ended_at TEXT NOT NULL, PRIMARY KEY (platform, started_at, ended_at)) STRICT; CREATE TABLE IF NOT EXISTS address_cache_coverage (platform TEXT NOT NULL, address TEXT NOT NULL, started_at TEXT NOT NULL, ended_at TEXT NOT NULL, PRIMARY KEY (platform, address, started_at, ended_at)) STRICT;',
    );
    return {
      platformCoverage: database
        .prepare(
          'SELECT platform, started_at, ended_at FROM platform_cache_coverage',
        )
        .all()
        .map((row: any) => ({
          platform: row.platform,
          startedAt: row.started_at,
          endedAt: row.ended_at,
        })),
      addressCoverage: database
        .prepare(
          'SELECT platform, address, started_at, ended_at FROM address_cache_coverage',
        )
        .all()
        .map((row: any) => ({
          platform: row.platform,
          address: row.address,
          startedAt: row.started_at,
          endedAt: row.ended_at,
        })),
    };
  } finally {
    database.close();
  }
}

function writeCoverage(
  platformCoverage: Coverage[],
  addressCoverage: AddressCoverage[],
) {
  const database = new DatabaseSync(join(cacheDir, 'cache.sqlite'));
  try {
    database.exec(
      'CREATE TABLE IF NOT EXISTS platform_cache_coverage (platform TEXT NOT NULL, started_at TEXT NOT NULL, ended_at TEXT NOT NULL, PRIMARY KEY (platform, started_at, ended_at)) STRICT; CREATE TABLE IF NOT EXISTS address_cache_coverage (platform TEXT NOT NULL, address TEXT NOT NULL, started_at TEXT NOT NULL, ended_at TEXT NOT NULL, PRIMARY KEY (platform, address, started_at, ended_at)) STRICT;',
    );
    const platformInsert = database.prepare(
      'INSERT OR IGNORE INTO platform_cache_coverage (platform, started_at, ended_at) VALUES (?, ?, ?)',
    );
    const addressInsert = database.prepare(
      'INSERT OR IGNORE INTO address_cache_coverage (platform, address, started_at, ended_at) VALUES (?, ?, ?, ?)',
    );
    for (const item of platformCoverage)
      platformInsert.run(item.platform, item.startedAt, item.endedAt);
    for (const item of addressCoverage)
      addressInsert.run(
        item.platform,
        item.address,
        item.startedAt,
        item.endedAt,
      );
  } finally {
    database.close();
  }
}

function checksum(path: string) {
  return new Promise<string>((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function pipelineEntry(source: NodeJS.ReadableStream, target: string) {
  return new Promise<void>((resolve, reject) => {
    const output = createWriteStream(target);
    source.on('error', reject);
    output.on('error', reject);
    output.on('close', resolve);
    source.pipe(output);
  });
}

function isSafeCachePath(path: string) {
  return (
    !path.startsWith('/') &&
    !path.includes('..') &&
    path.split('/').every(Boolean) &&
    path.endsWith('/eventLog.json')
  );
}
