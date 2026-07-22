const {
  chmodSync,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} = require('fs');
const { execFileSync } = require('child_process');
const { join, resolve } = require('path');

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
const cacheSnapshotEntry = join(
  dist,
  'src',
  'simulation-evaluator-worker-cache.main.js',
);

if (
  !existsSync(parentEntry) ||
  !existsSync(childEntry) ||
  !existsSync(cacheSnapshotEntry)
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
bundle(cacheSnapshotEntry, join(release, 'cache-snapshot'));

writeFileSync(
  join(scripts, 'worker-launcher.js'),
  [
    "const { join } = require('path');",
    "process.chdir(join(__dirname, '..'));",
    "process.env.SERVICE = 'SIMULATION_EVALUATOR_WORKER_SERVICE';",
    "process.env.SIMULATION_EVALUATOR_CHILD_ENTRY = join(process.cwd(), 'child', 'index.js');",
    "require('../parent/index.js');",
    '',
  ].join('\n'),
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
  [Parameter(Position = 0)][string]$Command = 'status',
  [Parameter(Position = 1)][string]$File
)
$ErrorActionPreference = 'Stop'

$validCommands = @('install', 'start', 'stop', 'status', 'uninstall', 'cache-export', 'cache-import')
if ($Command -notin $validCommands) {
  throw "Unknown command '$Command'. Use: $($validCommands -join ', ')"
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
$root = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node.exe -ErrorAction Stop).Source
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
  if ($File) { $arguments += ('"' + $File + '"') }
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

switch ($Command) {
  'install' {
    Assert-Configuration
    $action = New-ScheduledTaskAction -Execute $node -Argument ('"' + (Join-Path $root 'scripts\\worker-launcher.js') + '"') -WorkingDirectory $root
    $trigger = New-ScheduledTaskTrigger -AtStartup
    $taskPrincipal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    $settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Seconds 0) -StartWhenAvailable
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $taskPrincipal -Settings $settings -Force | Out-Null
    Start-ScheduledTask -TaskName $TaskName
    Write-Host "Installed and started $TaskName." -ForegroundColor Green
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
  'cache-export' {
    Assert-Configuration
    if (-not $File) { throw 'Provide a snapshot file, e.g. windows.cmd cache-export evaluator-cache.zip' }
    Write-Host 'Stopping evaluator; cache export begins after the safety wait...' -ForegroundColor Yellow
    Stop-Worker $true
    Start-Sleep -Seconds 16
    Push-Location $root
    try { & $node (Join-Path $root 'cache-snapshot\\index.js') export --file $File } finally { Pop-Location }
  }
  'cache-import' {
    Assert-Configuration
    if (-not $File) { throw 'Provide a snapshot file, e.g. windows.cmd cache-import evaluator-cache.zip' }
    Write-Host 'Stopping evaluator; cache import begins after the safety wait...' -ForegroundColor Yellow
    Stop-Worker $true
    Start-Sleep -Seconds 16
    Push-Location $root
    try { & $node (Join-Path $root 'cache-snapshot\\index.js') import --file $File } finally { Pop-Location }
  }
}
`,
);

writeFileSync(
  join(scripts, 'linux-commander.sh'),
  `#!/usr/bin/env sh
set -eu

COMMAND=\${1:-status}
FILE=\${2:-}
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
NODE=$(command -v node || true)

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
  echo 'Usage: ./linux.sh {install|start|stop|status|uninstall|cache-export|cache-import} [snapshot.zip]' >&2
}

case "$COMMAND" in install|start|stop|status|uninstall|cache-export|cache-import) ;; *) usage; exit 1 ;; esac
if [ -z "$NODE" ]; then echo 'Node.js 22 or newer is required.' >&2; exit 1; fi
if [ "$COMMAND" != status ] && [ "$(id -u)" -ne 0 ]; then echo "Run with sudo: sudo ./linux.sh $COMMAND\${FILE:+ $FILE}" >&2; exit 1; fi

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

case "$COMMAND" in
  install)
    assert_configuration
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
    systemctl enable --now "$SERVICE"
    systemctl --no-pager status "$SERVICE"
    ;;
  start) assert_configuration; systemctl start "$SERVICE" ;;
  stop) systemctl stop "$SERVICE" ;;
  status) systemctl --no-pager status "$SERVICE" ;;
  uninstall) systemctl disable --now "$SERVICE" 2>/dev/null || true; rm -f "/etc/systemd/system/$SERVICE.service"; systemctl daemon-reload ;;
  cache-export|cache-import)
    assert_configuration
    [ -n "$FILE" ] || { usage; exit 1; }
    systemctl stop "$SERVICE" 2>/dev/null || true
    sleep 16
    cd "$ROOT"
    if [ "$COMMAND" = cache-export ]; then "$NODE" cache-snapshot/index.js export --file "$FILE"; else "$NODE" cache-snapshot/index.js import --file "$FILE"; fi
    ;;
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

Requires Node.js 22 or newer. Configure \`.env\` before starting the worker.

\`SIMULATION_EVALUATOR_WORKER_INSTANCE\` is required and creates an isolated service identity. For example, \`dev\` uses \`LuckyEvaluatorWorker-dev\` on Windows and \`lucky-evaluator-worker-dev.service\` on Linux. Install each instance in its own directory so its identity and cache remain isolated.

Windows: run \`windows.cmd install\` as Administrator. Linux: run \`sudo ./linux.sh install\`. If extracting a bundle with a tool that drops Unix file modes, run \`chmod +x linux.sh scripts/linux-commander.sh\` once first.

Both entrypoints support \`install\`, \`start\`, \`stop\`, \`status\`, \`uninstall\`, \`cache-export <snapshot.zip>\`, and \`cache-import <snapshot.zip>\`.

For example: \`windows.cmd cache-export evaluator-cache.zip\` or \`sudo ./linux.sh cache-import evaluator-cache.zip\`. Cache operations stop the service and leave it stopped when complete.
`,
);

console.log(`Worker release created at ${release}`);
