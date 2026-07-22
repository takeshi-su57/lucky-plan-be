# Lucky Plans Backend

Lucky Plans is a NestJS backend for automated perp copy-trading, leaderboard indexing, and strategy simulation. The same codebase can boot as the public API service or as Redis-backed workers, selected by the `SERVICE` environment variable.

## What This System Does

The backend tracks on-chain perp trading events from supported venues, stores normalized actions and trade history in Postgres, exposes product workflows through GraphQL, and runs worker loops that turn leader activity into follower missions and tasks.

The current implementation supports:

- API, copy-trading, and analytics services from one Nest entry point.
- GraphQL queries, mutations, and subscriptions for plans, bots, missions, tasks, logs, contracts, simulations, auth, followers, strategies, SL/TP requests, prices, and trade histories.
- Redis transport for service status, process control, logging, and internal microservice messages.
- Prisma 7 with Postgres and a generated client in `generated/prisma`.
- EVM chain reads/writes through `viem`, with semaphore-controlled reads and mutex-controlled wallet writes.
- Platform adapters for GNS V9/V10, GMX V2, and AVNT V1.
- Walk-forward simulation tooling with a stable centralized flow and a worker-driven dynamic flow that evaluates research ranges concurrently.
- External evaluator clients with administrator-controlled enrollment, pause/drain, cache prebuild, and child-process capacity.

## Runtime Architecture

`src/main.ts` chooses one of four service modes:

- `API_SERVICE`: starts the HTTP Nest app, GraphQL API, GraphQL subscriptions, global validation, CORS, compression, and a Redis microservice listener.
- `COPY_TRADING_SERVICE`: starts a Redis microservice that scans configured live contracts, routes observed actions into missions/tasks, and executes available follower tasks on a schedule.
- `ANALYTICS_SERVICE`: starts a Redis microservice that indexes historical/finalized on-chain trade logs into `PerpTradingEventLog` records, builds PnL snapshots, refreshes leaderboard data, and runs simulation automation.
- `SIMULATION_EVALUATOR_WORKER_SERVICE`: starts an external evaluator client. It connects only to the API evaluator gateway and does not need Postgres, Redis, or BullMQ credentials.

Redis is used as the Nest microservice transport, not as the primary database. Postgres is the source of truth for domain state.

```text
Clients / frontend
        |
        v
API_SERVICE (HTTP + GraphQL + subscriptions)
        |
        | Prisma
        v
Postgres <------------------------------+
        ^                               |
        | Prisma                        |
        |                               |
COPY_TRADING_SERVICE ---- Redis ---- API_SERVICE
        |                               |
        v                               |
EVM RPC providers                       |
                                        |
ANALYTICS_SERVICE ---- Redis --------+
        |
        v
EVM RPC providers
```

## Main Code Paths

### API Surface

The API service is assembled in `src/microservices/apiService/api.module.ts`.

Important modules:

- `auth`: wallet/user auth and JWT issuing.
- `contracts`: configured trading contracts by platform, chain, version, status, and block cursors.
- `plans`, `bots`, `missions`, `tasks`, `actions`, `follower-actions`: the core copy-trading workflow state machine.
- `trade-histories`: indexed perp logs, PnL snapshots, leader positions, and summary calculations.
- `simulations`: manual and auto simulation workflows, daily simulation plans, leader selection, and aggregate metrics.
- `loggers`: persisted logs plus GraphQL subscriptions for operational events.
- `security`: Redis message handlers for password checks, app safety checks, encryption, and decryption.
- `follower`, `strategy`, `prices`, `sltp`: supporting account, strategy, pricing, and stop-loss/take-profit workflows.

GraphQL schema generation writes to `src/schema.gql`.

### Copy-Trading Worker

The copy-trading worker is assembled in `src/microservices/copyTradingService/copy-trading.module.ts`.

The main flow is:

1. `ContractMonitorService` scans every live contract from its saved cursor in block batches.
2. Platform-specific event parsers normalize raw logs into action items.
3. `ActionRouterService` routes follower and leader action items into persistent `Action`, `Mission`, `Task`, and `FollowerAction` records.
4. `TaskExecutorService` executes available tasks and reconciles failed or awaiting tasks.
5. Contract cursors advance only after a block batch is handled successfully.

The scanner intentionally rechecks a small block window (`TRADING_RECHECK_BLOCKS`, default `5`) to reduce reorg risk.

### Analytics Worker

The analytics worker is assembled in `src/microservices/analyticsService/analytics.module.ts`.

Its leaderboard module indexes finalized logs for live contracts, normalizes platform-specific trade events, calculates USD PnL per event, and stores those rows in `PerpTradingEventLog`. Its simulations module owns queued simulation automation and execution.

### Simulation Research Execution

Simulation research is evaluated by approved evaluator workers. The analytics worker dispatches leader-evaluation tasks and batches simulation work by available client capacity.

### Evaluator Worker Architecture

Evaluator clients are parent orchestrators. The parent is the only process that authenticates with the API gateway, owns task leases and heartbeats, accesses the local SQLite metadata store, runs cache prebuild tasks, and reports task results.

For leader-evaluation tasks, the parent forks child processes up to its active capacity. Children receive task input over IPC and read the shared file-based event-log cache directly. They never access SQLite, the server, or prebuild tasks. The parent session heartbeat file makes orphaned children exit after a parent crash or restart.

Administrators use the dedicated **Evaluator Workers** settings tab to approve/reject clients, prebuild cache windows, pause a client after its assigned tasks drain, resume it, and request a new child-process capacity. The UI shows requested and active capacity separately.

### Web3 Layer

The shared EVM layer lives in `src/web3`.

- `web3/evm-chains.service.ts` configures supported chains, public/private/paid RPC fallbacks, read semaphores, websocket clients, and write mutexes.
- `web3/evm-adapter.service.ts` provides higher-level operations for balances, approvals, transfers, gas estimation, blocks, receipts, and logs.
- `platform/gns`, `platform/gmx`, and `platform/avnt` hold ABI files, config maps, event parsers, and conversion helpers.

Supported chain IDs currently include Ethereum mainnet, Polygon, Base, Arbitrum, Arbitrum Sepolia, ApeChain, Avalanche, and MegaETH.

### Data Model

The Prisma schema is in `prisma/schema.prisma`.

Core groups:

- Configuration and users: `Metadata`, `User`, `Follower`, `Strategy`, `Contract`.
- Product workflow: `Plan`, `Bot`, `Mission`, `Task`, `Action`, `ActionProcessing`, `FollowerAction`, `SLTPRequest`.
- Historical analytics: `PerpTradingEventLog`, `PnlSnapshotV2`, `PnlSnapshotV2InitializedFlag`, `GnsPricingRecord`.
- Simulations: `Simulation`, `SimulationPlan`, `SimulationBot`, `SimulationLeaderSelection`.
- Operations: `Log`.

The Prisma client is generated to `generated/prisma`, so imports use paths like `generated/prisma/client` and `generated/prisma/enums`.

## Local Setup

Install dependencies:

```bash
npm install
```

Start local infrastructure:

```bash
docker compose up -d
```

Create a `.env` from `.env.sample`, then set at least:

```bash
DATABASE_URL=postgresql://luckyplans:luckyplans@localhost:5434/luckyplans
JWT_SECRET=replace-me
JWT_EXPIRES_IN=7d
PORT=3000
ENV=local
SERVICE=API_SERVICE
REDIS_HOST=localhost
REDIS_PORT=6379
```

Generate Prisma client and apply migrations:

```bash
npx prisma generate
npx prisma migrate dev
```

Seed known contracts:

```bash
npx prisma db seed
```

## Running Services

Run the API:

```bash
$env:SERVICE="API_SERVICE"; npm run start:dev
```

Run the copy-trading worker:

```bash
$env:SERVICE="COPY_TRADING_SERVICE"; npm run start:dev
```

Run the analytics worker:

```bash
$env:SERVICE="ANALYTICS_SERVICE"; npm run start:dev
```

Run an external evaluator worker:

```bash
$env:SERVICE="SIMULATION_EVALUATOR_WORKER_SERVICE"; npm run start:prod
```

Each worker uses `SIMULATION_EVALUATOR_GATEWAY_URL` and stores its local SQLite identity, parent-session heartbeat, and event-log cache at `.cache/simulation-evaluator-worker` in the source directory. This directory contains the worker ID and key pair, so it must persist across restarts and upgrades. On its first interactive start it asks for a recognizable worker name and persists an ID in the form `<name>_<uuid>`. For a non-interactive deployment, set `SIMULATION_EVALUATOR_WORKER_NAME` instead. On first startup it requests enrollment; an administrator must approve it in the dedicated **Evaluator Workers** tab before it receives work. Nginx terminates HTTPS in front of `API_SERVICE`; workers never receive Postgres, Redis, or BullMQ credentials.

## Portable Evaluator Worker Release

The worker can be shipped without cloning the repository or installing npm dependencies on the target machine. Build a portable Node 22+ release bundle:

```bash
npm run build:cross
```

The output is `release/evaluator-worker`. Its root stays intentionally small: `parent`, `child`, `adopt`, `scripts`, `.env`, `.env.example`, `windows.cmd`, `linux.sh`, and `README.md`. The build uses `ncc` through `npx`; that tooling is needed only by the build environment, never by the worker host.

Configure `.env` in the extracted release:

```env
SIMULATION_EVALUATOR_WORKER_INSTANCE=dev
SIMULATION_EVALUATOR_GATEWAY_URL=https://api.example.com
SIMULATION_EVALUATOR_WORKER_NAME=dev-worker-01
```

Install each worker instance in its own directory. The instance value isolates its service name, local identity, and cache; use a distinct value such as `dev` or `prod` for every worker environment on the same host.

Then use the single platform commander to install it as a background service:

- Windows: run `windows.cmd install`; approve UAC when prompted. For `dev`, it creates the `LuckyEvaluatorWorker-dev` Scheduled Task.
- Linux: run `sudo ./linux.sh install`; for `dev`, it creates and starts `lucky-evaluator-worker-dev.service`. If the extraction tool dropped the executable bits, restore them once with `chmod +x linux.sh scripts/linux-commander.sh`.

Both commanders support `install`, `adopt`, `start`, `stop`, `status`, and `uninstall`.

When upgrading a legacy release that used the fixed `LuckyEvaluatorWorker` task or `lucky-evaluator-worker.service`, uninstall that legacy service first, then install the instance-based release in a separate directory.

The release workflow in `.github/workflows/release-evaluator-worker.yml` builds and publishes `lucky-evaluator-worker-node22.zip` when a `worker-v*` tag is pushed. It also uploads the ZIP as a short-lived Actions artifact.

### Adopt a Prebuilt Cache

For a large cache, stop the source worker and archive its `.cache` directory using a system-level archiver. Transfer the archive and extract it manually into the new release directory, preserving this path:

```text
.cache/simulation-evaluator-worker/cache.sqlite
```

Configure `.env` with the new worker's name, instance, and gateway URL, then adopt the extracted cache:

```bash
# Windows
windows.cmd adopt

# Linux
sudo ./linux.sh adopt
```

`adopt` does not read or extract archives. It retains event-log files and cache coverage, removes the source worker identity, parent runtime state, and stale prebuild task checkpoints, then installs and starts a newly enrolled worker. After approval, request a prebuild/resync in the admin panel; the transferred local cache lets it complete quickly.

On non-PowerShell shells, use the equivalent inline environment syntax for your shell.

## Useful Commands

```bash
npm run build
npm run lint
npm run test
npm run test:e2e
npm run build:cross
npm run test:cov
npx prisma generate
npx prisma migrate dev
npx prisma studio
```

Notes:

- `npm run lint` currently runs ESLint with `--fix`.
- RPC-heavy worker commands can hit public provider rate limits unless private/paid RPC tokens are configured.

## Environment Variables

The sample file lists the expected variables:

- `DATABASE_URL`: Postgres connection string used by Prisma and the Prisma PG adapter.
- `SERVICE`: one of `API_SERVICE`, `COPY_TRADING_SERVICE`, `ANALYTICS_SERVICE`, or `SIMULATION_EVALUATOR_WORKER_SERVICE`.
- `PORT`: API HTTP port.
- `REDIS_HOST`, `REDIS_PORT`: Redis transport endpoint.
- `JWT_SECRET`, `JWT_EXPIRES_IN`: auth token settings.
- `BOT_HOOK_ADDRESS`, `API_URL`, `BACKTEST_INTERNAL_SECRET`, `OPTUNA_POSTGRES_URL`: integration/backtest settings used by surrounding workflows.
- `DRPC_TOKENS`, `DRPC_PAID_TOKENS`, `ALCHEMY_TOKENS`: comma-separated RPC tokens.
- `ALCHEMY_PAID_TOENS`: currently misspelled in code and sample; keep that spelling unless the code is fixed at the same time.
- `TRADING_RECHECK_BLOCKS`: optional copy-trading scanner replay window.
- `SIMULATION_EVALUATOR_GATEWAY_URL`: HTTPS URL of the API evaluator gateway used by external evaluator parents.
- `SIMULATION_EVALUATOR_WORKER_INSTANCE`: required lowercase host-local instance identifier; it isolates the worker service/task, identity, and cache from other worker environments on the same machine.
- `SIMULATION_EVALUATOR_WORKER_NAME`: required on a first non-interactive evaluator start; becomes part of the persisted worker identity.

## Implementation Rules Of Thumb

- Keep API-facing types in each module's `dto` and `entities` folders.
- Keep platform-specific ABI/config/parser logic under `src/web3/platform/<platform>/<version>`.
- When changing database shape, add a Prisma migration and regenerate the client.
- When changing generated GraphQL shape, rebuild or run the API once so `src/schema.gql` reflects the current decorators.
- Treat copy-trading task execution and wallet writes as high-risk paths. Prefer small, testable changes and verify idempotency through database constraints such as `Action.dedupeKey`, `ActionProcessing`, and unique task/action pairs.
- Do not assume all contracts are live. Many seeded contracts are `Dead`; workers filter by `ContractStatus.Live`.
