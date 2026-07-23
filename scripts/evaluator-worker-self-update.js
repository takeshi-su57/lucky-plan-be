const { createHash } = require('crypto');
const { execFileSync } = require('child_process');
const {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} = require('fs');
const { join, resolve } = require('path');

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .flatMap((value, index, values) =>
      value.startsWith('--') && values[index + 1]
        ? [[value.slice(2), values[index + 1]]]
        : [],
    ),
);
const root = resolve(__dirname, '..');
const cache = join(root, '.cache', 'simulation-evaluator-worker');
const pending = join(cache, 'pending-update.json');
const allowed = (value) => {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'github.com' ||
    !url.pathname.startsWith('/takeshi-su57/lucky-plan-be/releases/download/')
  )
    throw new Error('unapproved release URL');
  return url;
};
const write = (path, value) =>
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
const emit = (percent, message, bytes = 0, totalBytes = 0) =>
  process.stdout.write(
    `${JSON.stringify({ percent, message, bytes, totalBytes })}\n`,
  );

async function prepare() {
  const version = args.version;
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version || ''))
    throw new Error('invalid version');
  const url = allowed(args.url);
  const checksumUrl = allowed(args['checksum-url']);
  const stage = join(cache, 'updates', args['task-id']);
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });
  const archive = join(stage, 'release.zip');
  emit(12, `Connecting to evaluator worker release ${version}`);
  const [archiveResponse, checksumResponse] = await Promise.all([
    fetch(url, { signal: AbortSignal.timeout(10 * 60_000) }),
    fetch(checksumUrl, { signal: AbortSignal.timeout(60_000) }),
  ]);
  if (!archiveResponse.ok || !checksumResponse.ok)
    throw new Error('release download failed');
  const totalBytes = Number(archiveResponse.headers.get('content-length')) || 0;
  const chunks = [];
  let downloadedBytes = 0;
  let lastReportedBytes = 0;
  for await (const chunk of archiveResponse.body) {
    const bytes = Buffer.from(chunk);
    chunks.push(bytes);
    downloadedBytes += bytes.length;
    if (
      downloadedBytes - lastReportedBytes >= 1024 * 1024 ||
      downloadedBytes === totalBytes
    ) {
      const ratio = totalBytes ? Math.min(1, downloadedBytes / totalBytes) : 0;
      emit(
        15 + Math.round(ratio * 50),
        `Downloading evaluator worker ${version}`,
        downloadedBytes,
        totalBytes,
      );
      lastReportedBytes = downloadedBytes;
    }
  }
  const bytes = Buffer.concat(chunks);
  const expected = (await checksumResponse.text()).trim().split(/\s+/)[0];
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (!/^[a-f0-9]{64}$/i.test(expected) || actual !== expected)
    throw new Error('release checksum mismatch');
  emit(
    70,
    `Checksum verified for evaluator worker ${version}`,
    downloadedBytes,
    totalBytes,
  );
  writeFileSync(archive, bytes);
  const extracted = join(stage, 'extracted');
  emit(
    78,
    `Extracting evaluator worker ${version}`,
    downloadedBytes,
    totalBytes,
  );
  if (process.platform === 'win32')
    execFileSync('powershell.exe', [
      '-NoProfile',
      '-Command',
      `Expand-Archive -LiteralPath '${archive.replace(/'/g, "''")}' -DestinationPath '${extracted.replace(/'/g, "''")}' -Force`,
    ]);
  else execFileSync('unzip', ['-q', archive, '-d', extracted]);
  const release = join(extracted, 'evaluator-worker');
  if (
    !existsSync(join(release, 'version.json')) ||
    JSON.parse(readFileSync(join(release, 'version.json'), 'utf8')).version !==
      version
  )
    throw new Error('release version mismatch');
  emit(
    88,
    `Evaluator worker ${version} verified and ready`,
    downloadedBytes,
    totalBytes,
  );
  write(pending, {
    taskId: args['task-id'],
    leaseToken: args['lease-token'],
    version,
    release,
  });
}

prepare().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
