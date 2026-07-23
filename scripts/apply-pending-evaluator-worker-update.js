const {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} = require('fs');
const { join, resolve } = require('path');
const root = resolve(__dirname, '..');
const cache = join(root, '.cache', 'simulation-evaluator-worker');
const pendingPath = join(cache, 'pending-update.json');
const resultPath = join(cache, 'update-result.json');
if (!existsSync(pendingPath)) process.exit(0);
const pending = JSON.parse(readFileSync(pendingPath, 'utf8'));
const backup = join(cache, 'update-backup');
const items = [
  'parent',
  'child',
  'adopt',
  'scripts',
  'windows.cmd',
  'linux.sh',
  'README.md',
  '.env.example',
  'version.json',
];
try {
  rmSync(backup, { recursive: true, force: true });
  mkdirSync(backup, { recursive: true });
  for (const item of items) {
    const from = join(root, item);
    const to = join(backup, item);
    if (existsSync(from)) renameSync(from, to);
    cpSync(join(pending.release, item), from, { recursive: true });
  }
  writeFileSync(
    resultPath,
    `${JSON.stringify({ ...pending, status: 'applied' })}\n`,
  );
  rmSync(pendingPath, { force: true });
} catch (error) {
  for (const item of items) {
    const previous = join(backup, item);
    const destination = join(root, item);
    if (!existsSync(previous)) continue;
    rmSync(destination, { recursive: true, force: true });
    renameSync(previous, destination);
  }
  writeFileSync(
    resultPath,
    `${JSON.stringify({ ...pending, status: 'failed', error: error instanceof Error ? error.message : String(error) })}\n`,
  );
  rmSync(pendingPath, { force: true });
}
