const { execFileSync, spawn } = require('child_process');
const { existsSync, readFileSync } = require('fs');
const { join, resolve } = require('path');

const EVALUATOR_WORKER_UPGRADE_EXIT_CODE = 75;

const shouldRestartAfterUpgrade = (exitCode, pendingUpdateExists) =>
  exitCode === EVALUATOR_WORKER_UPGRADE_EXIT_CODE || pendingUpdateExists;

async function runWorker(root = resolve(__dirname, '..')) {
  const updateScript = join(
    root,
    'scripts',
    'apply-pending-evaluator-worker-update.js',
  );
  const pendingUpdate = join(
    root,
    '.cache',
    'simulation-evaluator-worker',
    'pending-update.json',
  );
  let stopping = false;

  while (!stopping) {
    execFileSync(process.execPath, [updateScript], { stdio: 'inherit' });
    const version = JSON.parse(
      readFileSync(join(root, 'version.json'), 'utf8'),
    ).version;
    const child = spawn(process.execPath, [join(root, 'parent', 'index.js')], {
      cwd: root,
      env: {
        ...process.env,
        SERVICE: 'SIMULATION_EVALUATOR_WORKER_SERVICE',
        SIMULATION_EVALUATOR_WORKER_VERSION: version,
        SIMULATION_EVALUATOR_CHILD_ENTRY: join(root, 'child', 'index.js'),
      },
      stdio: 'inherit',
      windowsHide: true,
    });
    const forwardSignal = (signal) => {
      stopping = true;
      if (child.exitCode === null && !child.killed) child.kill(signal);
    };
    process.once('SIGINT', forwardSignal);
    process.once('SIGTERM', forwardSignal);
    const exitCode = await new Promise((resolveExit, reject) => {
      child.once('error', reject);
      child.once('exit', (code) => resolveExit(code ?? 1));
    }).finally(() => {
      process.off('SIGINT', forwardSignal);
      process.off('SIGTERM', forwardSignal);
    });
    if (stopping) return 0;
    if (shouldRestartAfterUpgrade(exitCode, existsSync(pendingUpdate))) {
      continue;
    }
    return exitCode;
  }
  return 0;
}

if (require.main === module) {
  runWorker()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}

module.exports = {
  EVALUATOR_WORKER_UPGRADE_EXIT_CODE,
  runWorker,
  shouldRestartAfterUpgrade,
};
