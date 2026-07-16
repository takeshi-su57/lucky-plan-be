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
- Walk-forward simulation tooling that selects leaders from historical PnL, builds daily simulation plans, and evaluates reversed/default follower performance.

## Runtime Architecture

`src/main.ts` chooses one of three service modes:

- `API_SERVICE`: starts the HTTP Nest app, GraphQL API, GraphQL subscriptions, global validation, CORS, compression, and a Redis microservice listener.
- `COPY_TRADING_SERVICE`: starts a Redis microservice that scans configured live contracts, routes observed actions into missions/tasks, and executes available follower tasks on a schedule.
- `ANALYTICS_SERVICE`: starts a Redis microservice that indexes historical/finalized on-chain trade logs into `PerpTradingEventLog` records, builds PnL snapshots, refreshes leaderboard data, and runs simulation automation.

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

Each worker uses `SIMULATION_EVALUATOR_GATEWAY_URL` and stores its local SQLite identity and event-log cache at `.cache/simulation-evaluator-worker` in the source directory. This directory contains the worker ID and key pair, so it must persist across restarts. Set `SIMULATION_EVALUATOR_WORKER_NAME` to a recognizable label (for example, `evaluator-eu-1`) so administrators can identify the worker in the control panel. On first startup it requests enrollment; an administrator must approve it in the worker control panel before it receives work. Nginx terminates HTTPS in front of `API_SERVICE`; workers never receive Postgres, Redis, or BullMQ credentials.

On non-PowerShell shells, use the equivalent inline environment syntax for your shell.

## Useful Commands

```bash
npm run build
npm run lint
npm run test
npm run test:e2e
npm run test:cov
npx prisma generate
npx prisma migrate dev
npx prisma studio
```

Notes:

- `npm run lint` currently runs ESLint with `--fix`.
- `test/app.e2e-spec.ts` appears to be stale: it imports `AppModule` from `api.module`, but the exported class is `ApiModule`.
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

## Implementation Rules Of Thumb

- Keep API-facing types in each module's `dto` and `entities` folders.
- Keep platform-specific ABI/config/parser logic under `src/web3/platform/<platform>/<version>`.
- When changing database shape, add a Prisma migration and regenerate the client.
- When changing generated GraphQL shape, rebuild or run the API once so `src/schema.gql` reflects the current decorators.
- Treat copy-trading task execution and wallet writes as high-risk paths. Prefer small, testable changes and verify idempotency through database constraints such as `Action.dedupeKey`, `ActionProcessing`, and unique task/action pairs.
- Do not assume all contracts are live. Many seeded contracts are `Dead`; workers filter by `ContractStatus.Live`.
