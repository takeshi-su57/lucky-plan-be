const {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} = require('fs');
const { execFileSync } = require('child_process');
const { join, resolve } = require('path');
const packageJson = require('../package.json');

const root = resolve(__dirname, '..');
const dist = join(root, 'dist');
const release = join(root, 'release', 'evaluator-worker');
const scripts = join(release, 'scripts');
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const parentEntry = join(dist, 'src', 'simulation-evaluator-worker.main.js');
const childEntry = join(
  dist,
  'src',
  'microservices',
  'simulationEvaluatorWorker',
  'simulation-evaluator-worker-child.js',
);
const cacheAdoptEntry = join(
  dist,
  'src',
  'simulation-evaluator-worker-adopt.main.js',
);
const workerVersion =
  process.env.SIMULATION_EVALUATOR_WORKER_VERSION ||
  process.env.LUCKY_BACKEND_VERSION ||
  packageJson.version;

if (
  !existsSync(parentEntry) ||
  !existsSync(childEntry) ||
  !existsSync(cacheAdoptEntry)
) {
  throw new Error('Worker build output is missing. Run npm run build first.');
}

rmSync(release, { recursive: true, force: true });
mkdirSync(scripts, { recursive: true });

function bundle(entry, output) {
  execFileSync(
    npx,
    ['--yes', '--package', '@vercel/ncc', 'ncc', 'build', entry, '-o', output],
    { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' },
  );
}

bundle(parentEntry, join(release, 'parent'));
bundle(childEntry, join(release, 'child'));
bundle(cacheAdoptEntry, join(release, 'adopt'));

cpSync(
  join(__dirname, 'evaluator-worker-launcher.js'),
  join(scripts, 'worker-launcher.js'),
);
cpSync(
  join(__dirname, 'evaluator-worker-self-update.js'),
  join(scripts, 'evaluator-worker-self-update.js'),
);
cpSync(
  join(__dirname, 'apply-pending-evaluator-worker-update.js'),
  join(scripts, 'apply-pending-evaluator-worker-update.js'),
);
writeFileSync(
  join(release, 'version.json'),
  `${JSON.stringify({ version: workerVersion }, null, 2)}\n`,
);

writeFileSync(
  join(release, 'windows.cmd'),
  '@echo off\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\\windows-commander.ps1" %*\r\n',
);
writeFileSync(
  join(release, 'linux.sh'),
  '#!/usr/bin/env sh\nset -eu\nexec "$(dirname "$0")/scripts/linux-commander.sh" "$@"\n',
);
chmodSync(join(release, 'linux.sh'), 0o755);

writeFileSync(
  join(scripts, 'windows-commander.ps1'),
  `param(
  [Parameter(Position = 0)][string]$Command = 'status'
)
$ErrorActionPreference = 'Stop'

$validCommands = @('install', 'adopt', 'start', 'stop', 'status', 'uninstall')
if ($Command -notin $validCommands) {
  throw "Unknown command '$Command'. Use: $($validCommands -join ', ')"
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
$root = Split-Path -Parent $PSScriptRoot
$node = if ($env:LUCKY_EVALUATOR_NODE) {
  $env:LUCKY_EVALUATOR_NODE
} else {
  (Get-Command node.exe -ErrorAction Stop).Source
}
$nodeVersion = & $node -p "process.versions.node"
if ([version]$nodeVersion -lt [version]'25.0.0') {
  throw "Node.js 25.0.0 or newer is required. Scheduled task Node: $node ($nodeVersion)"
}
& $node -e "require('node:sqlite').DatabaseSync"
if ($LASTEXITCODE -ne 0) {
  throw "The selected Node.js binary does not provide node:sqlite: $node"
}
$env:LUCKY_EVALUATOR_NODE = $node
$envFile = Join-Path $root '.env'

function Get-WorkerInstance {
  if (-not (Test-Path $envFile)) {
    Copy-Item (Join-Path $root '.env.example') $envFile
    throw 'Created .env. Set SIMULATION_EVALUATOR_WORKER_INSTANCE, SIMULATION_EVALUATOR_GATEWAY_URL, and SIMULATION_EVALUATOR_WORKER_NAME, then run the command again.'
  }
  $content = Get-Content $envFile -Raw
  $match = [regex]::Match($content, '(?m)^SIMULATION_EVALUATOR_WORKER_INSTANCE=([a-z0-9](?:[a-z0-9-]{0,62})?)\\s*$')
  if (-not $match.Success) {
    throw 'Set SIMULATION_EVALUATOR_WORKER_INSTANCE to a lowercase letter/number/hyphen identifier in .env first.'
  }
  return $match.Groups[1].Value
}

$instance = Get-WorkerInstance
$TaskName = "LuckyEvaluatorWorker-$instance"

if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  $arguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $PSCommandPath + '"'), $Command)
  Start-Process powershell.exe -Verb RunAs -ArgumentList $arguments
  exit
}

function Assert-Configuration {
  if (-not (Test-Path $envFile)) {
    Copy-Item (Join-Path $root '.env.example') $envFile
    throw 'Created .env. Set SIMULATION_EVALUATOR_WORKER_INSTANCE, SIMULATION_EVALUATOR_GATEWAY_URL, and SIMULATION_EVALUATOR_WORKER_NAME, then run the command again.'
  }
  $content = Get-Content $envFile -Raw
  if ($content -notmatch '(?m)^SIMULATION_EVALUATOR_GATEWAY_URL=https?://.+' -or $content -notmatch '(?m)^SIMULATION_EVALUATOR_WORKER_NAME=.+' -or $content -notmatch '(?m)^SIMULATION_EVALUATOR_WORKER_INSTANCE=[a-z0-9](?:[a-z0-9-]{0,62})?\\s*$') {
    throw 'Set SIMULATION_EVALUATOR_WORKER_INSTANCE, SIMULATION_EVALUATOR_GATEWAY_URL, and SIMULATION_EVALUATOR_WORKER_NAME in .env first.'
  }
}

function Stop-Worker([bool]$IgnoreMissing = $false) {
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if (-not $task) {
    if (-not $IgnoreMissing) { throw "Scheduled task $TaskName is not installed." }
    return
  }
  if ($task.State -ne 'Ready') { Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue }
}

function Install-Worker {
  $action = New-ScheduledTaskAction -Execute $node -Argument ('"' + (Join-Path $root 'scripts\\worker-launcher.js') + '"') -WorkingDirectory $root
  $trigger = New-ScheduledTaskTrigger -AtStartup
  $taskPrincipal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
  $settings = New-ScheduledTaskSettingsSet -RestartCount 255 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Seconds 0) -StartWhenAvailable
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $taskPrincipal -Settings $settings -Force | Out-Null
  Start-ScheduledTask -TaskName $TaskName
  Write-Host "Installed and started $TaskName." -ForegroundColor Green
}

switch ($Command) {
  'install' {
    Assert-Configuration
    Install-Worker
  }
  'adopt' {
    Assert-Configuration
    Write-Host 'Adopting the manually extracted .cache directory...' -ForegroundColor Yellow
    Stop-Worker $true
    Start-Sleep -Seconds 16
    Push-Location $root
    try { & $node (Join-Path $root 'adopt\\index.js') } finally { Pop-Location }
    Install-Worker
  }
  'start' { Assert-Configuration; Start-ScheduledTask -TaskName $TaskName; Write-Host "Started $TaskName." -ForegroundColor Green }
  'stop' { Stop-Worker; Write-Host "Stopped $TaskName." -ForegroundColor Yellow }
  'status' {
    $task = Get-ScheduledTask -TaskName $TaskName
    $info = Get-ScheduledTaskInfo -TaskName $TaskName
    [PSCustomObject]@{
      TaskName = $task.TaskName
      State = $task.State
      LastRunTime = $info.LastRunTime
      LastTaskResult = $info.LastTaskResult
      NextRunTime = $info.NextRunTime
    } | Format-List
  }
  'uninstall' { Stop-Worker $true; Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue; Write-Host "Uninstalled $TaskName." -ForegroundColor Yellow }
}
`,
);

writeFileSync(
  join(scripts, 'linux-commander.sh'),
  `#!/usr/bin/env sh
set -eu

COMMAND=\${1:-status}
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
NODE=\${NODE_BINARY:-$(command -v node || true)}

get_instance() {
  if [ ! -f "$ROOT/.env" ]; then
    cp "$ROOT/.env.example" "$ROOT/.env"
    echo 'Created .env. Set SIMULATION_EVALUATOR_WORKER_INSTANCE, SIMULATION_EVALUATOR_GATEWAY_URL, and SIMULATION_EVALUATOR_WORKER_NAME, then run the command again.' >&2
    exit 1
  fi
  INSTANCE=$(grep -E '^SIMULATION_EVALUATOR_WORKER_INSTANCE=[a-z0-9]([a-z0-9-]{0,62})?$' "$ROOT/.env" | head -n 1 | cut -d= -f2- || true)
  if [ -z "$INSTANCE" ]; then
    echo 'Set SIMULATION_EVALUATOR_WORKER_INSTANCE to a lowercase letter/number/hyphen identifier in .env first.' >&2
    exit 1
  fi
}

get_instance
SERVICE="lucky-evaluator-worker-$INSTANCE"

usage() {
  echo 'Usage: ./linux.sh {install|adopt|start|stop|status|uninstall}' >&2
}

case "$COMMAND" in install|adopt|start|stop|status|uninstall) ;; *) usage; exit 1 ;; esac
if [ -z "$NODE" ] || [ ! -x "$NODE" ]; then
  echo 'Node.js 25.0.0 or newer is required. Set NODE_BINARY to an absolute Node.js path when sudo uses a different PATH.' >&2
  exit 1
fi
if ! "$NODE" -e "const major = Number(process.versions.node.split('.')[0]); if (major < 25) process.exit(1); require('node:sqlite').DatabaseSync" >/dev/null 2>&1; then
  echo "Node.js 25.0.0 or newer with node:sqlite is required. Selected binary: $NODE ($("$NODE" --version 2>/dev/null || echo unknown))" >&2
  echo 'If your newer Node.js is installed through nvm, run: sudo NODE_BINARY="$(command -v node)" ./linux.sh install' >&2
  exit 1
fi
if [ "$COMMAND" != status ] && [ "$(id -u)" -ne 0 ]; then echo "Run with sudo: sudo ./linux.sh $COMMAND" >&2; exit 1; fi

assert_configuration() {
  if [ ! -f "$ROOT/.env" ]; then
    cp "$ROOT/.env.example" "$ROOT/.env"
    echo 'Created .env. Set SIMULATION_EVALUATOR_WORKER_INSTANCE, SIMULATION_EVALUATOR_GATEWAY_URL, and SIMULATION_EVALUATOR_WORKER_NAME, then run the command again.' >&2
    exit 1
  fi
  if ! grep -Eq '^SIMULATION_EVALUATOR_GATEWAY_URL=https?://.+' "$ROOT/.env" || ! grep -Eq '^SIMULATION_EVALUATOR_WORKER_NAME=.+' "$ROOT/.env" || ! grep -Eq '^SIMULATION_EVALUATOR_WORKER_INSTANCE=[a-z0-9]([a-z0-9-]{0,62})?$' "$ROOT/.env"; then
    echo 'Set SIMULATION_EVALUATOR_WORKER_INSTANCE, SIMULATION_EVALUATOR_GATEWAY_URL, and SIMULATION_EVALUATOR_WORKER_NAME in .env first.' >&2
    exit 1
  fi
}

install_worker() {
  cat > /etc/systemd/system/$SERVICE.service <<EOF
[Unit]
Description=Lucky evaluator worker ($INSTANCE)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$ROOT
EnvironmentFile=$ROOT/.env
ExecStart=$NODE $ROOT/scripts/worker-launcher.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl reset-failed "$SERVICE" 2>/dev/null || true
  systemctl enable --now "$SERVICE"
  ATTEMPT=0
  while [ "$ATTEMPT" -lt 15 ]; do
    if [ -f "$ROOT/.cache/simulation-evaluator-worker/cache.sqlite" ]; then
      sleep 2
      RESTARTS=$(systemctl show "$SERVICE" --property=NRestarts --value)
      if systemctl is-active --quiet "$SERVICE" && [ "$RESTARTS" = "0" ]; then
        systemctl --no-pager status "$SERVICE"
        return
      fi
      break
    fi
    sleep 1
    ATTEMPT=$((ATTEMPT + 1))
  done
  echo "Worker installation failed its startup check. Node: $NODE ($("$NODE" --version))" >&2
  systemctl --no-pager status "$SERVICE" >&2 || true
  journalctl --no-pager -u "$SERVICE" -n 50 >&2 || true
  return 1
}

case "$COMMAND" in
  install)
    assert_configuration
    install_worker
    ;;
  adopt)
    assert_configuration
    systemctl stop "$SERVICE" 2>/dev/null || true
    sleep 16
    cd "$ROOT"
    "$NODE" adopt/index.js
    install_worker
    ;;
  start) assert_configuration; systemctl start "$SERVICE" ;;
  stop) systemctl stop "$SERVICE" ;;
  status) systemctl --no-pager status "$SERVICE" ;;
  uninstall) systemctl disable --now "$SERVICE" 2>/dev/null || true; rm -f "/etc/systemd/system/$SERVICE.service"; systemctl daemon-reload ;;
esac
`,
);
chmodSync(join(scripts, 'linux-commander.sh'), 0o755);

const envTemplate =
  'SIMULATION_EVALUATOR_WORKER_INSTANCE=\nSIMULATION_EVALUATOR_GATEWAY_URL=\nSIMULATION_EVALUATOR_WORKER_NAME=\n';
writeFileSync(join(release, '.env.example'), envTemplate);
writeFileSync(join(release, '.env'), envTemplate);
writeFileSync(
  join(release, 'README.md'),
  `# Lucky evaluator worker

Requires Node.js 25.0.0 or newer. Configure \`.env\` before starting the worker.

\`SIMULATION_EVALUATOR_WORKER_INSTANCE\` is required and creates an isolated service identity. For example, \`dev\` uses \`LuckyEvaluatorWorker-dev\` on Windows and \`lucky-evaluator-worker-dev.service\` on Linux. Install each instance in its own directory so its identity and cache remain isolated.

Windows: run \`windows.cmd install\` as Administrator. Linux: run \`sudo ./linux.sh install\`. If extracting a bundle with a tool that drops Unix file modes, run \`chmod +x linux.sh scripts/linux-commander.sh\` once first.

Both entrypoints support \`install\`, \`adopt\`, \`start\`, \`stop\`, \`status\`, and \`uninstall\`.

To reuse a prebuilt cache, extract the transferred archive manually so the release root contains \`.cache/simulation-evaluator-worker/cache.sqlite\`, configure \`.env\` for this worker, then run \`windows.cmd adopt\` or \`sudo ./linux.sh adopt\`. Adopt removes the source worker identity, parent runtime state, and stale task checkpoints while retaining event-log files and cache coverage. It then installs and starts this worker.
`,
);

console.log(`Worker release created at ${release}`);
