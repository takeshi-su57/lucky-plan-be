# AGENTS.md

This file is for coding agents working in the Lucky Plans backend. The goal is fast, confident changes without accidentally disturbing production-like trading workflows.

## First Read

Start with these files before changing behavior:

- `README.md` for the system map and local commands.
- `src/main.ts` for service boot selection.
- `src/microservices/apiService/api.module.ts` for the GraphQL/API module graph.
- `src/microservices/copyTradingService/copy-trading-flow.service.ts` for the live copy-trading loop.
- `src/microservices/analyticsService/modules/leaderboard/leaderboard.service.ts` for historical log indexing.
- `src/microservices/analyticsService/modules/simulations/**` for simulation execution and automation.
- `prisma/schema.prisma` for persistence contracts.

## Worktree Hygiene

- Check `git status --short --branch` before editing.
- Do not revert user changes unless explicitly asked.
- Keep edits scoped to the request. This repo has many domain modules, and drive-by refactors can create expensive regressions.
- Root `.agents/` may contain local agent assets. Do not modify it unless the user asks.

If Git reports dubious ownership in this sandbox, use:

```bash
git -c safe.directory=E:/how-to-work/repos/luckyplans/alpha/be status --short --branch
```

## Commands

Use these as the default verification ladder:

```bash
npm run build
npm run lint
npm run test
```

For database changes:

```bash
npx prisma generate
npx prisma migrate dev
```

For local infrastructure:

```bash
docker compose up -d
```

PowerShell service runs:

```bash
$env:SERVICE="API_SERVICE"; npm run start:dev
$env:SERVICE="COPY_TRADING_SERVICE"; npm run start:dev
$env:SERVICE="ANALYTICS_SERVICE"; npm run start:dev
```

## Fast Agent Loop

Use this loop for most feature and fix work:

1. Map the request to the owning module, service, and Prisma model.
2. Read the neighboring resolver/service/entity code before designing a new shape.
3. Make the smallest complete change that preserves existing module boundaries.
4. Run the narrowest useful verification first, then broaden if the change touches shared behavior.
5. End with the files changed, validation result, and any known risk.

Good local search anchors:

- GraphQL API behavior: `src/microservices/apiService/modules/**`.
- Worker behavior: `src/microservices/copyTradingService/**` and `src/microservices/analyticsService/**`.
- Chain/event behavior: `src/web3/platform/**` and `src/web3/utils.ts`.
- Data contracts: `prisma/schema.prisma`, module `dto`, and module `entities`.
- Cross-service event names: `src/utils/constants.ts`.

## Token Usage Optimization

Keep context lean. This repo is large enough that reading everything makes agents slower and less accurate.

- Start with `rg --files` or targeted `Get-ChildItem`, then open only the files that own the requested behavior.
- Prefer `rg "symbolOrResolverName" src prisma -n` over broad file reads.
- Read module entry files first, then the specific resolver/service/entity touched by the request.
- Avoid opening generated artifacts unless the bug is explicitly in generated output. `generated/prisma`, `dist`, `node_modules`, and large migration history usually do not belong in context.
- For Prisma work, read the relevant model block plus nearby enums instead of the entire schema after the first orientation pass.
- For GraphQL work, inspect decorators in the owning resolver/entity instead of reading all of `src/schema.gql`.
- For web3 platform work, read the platform/version parser and shared `src/web3/utils.ts`; avoid loading every ABI file unless the event signature or argument shape is the issue.
- For simulations, start from `simulations.resolver.ts`, `simulations.service.ts`, and only the subordinate service named by the failing behavior.
- Use `Select-String`, `rg -n`, or small file slices for line references when reporting. Do not paste long command output into the final response.
- Summarize discovered architecture in your own words before adding more files to context. If the next file does not change the implementation decision, skip it.
- Run narrow verification first: build for type changes, targeted Jest for testable services, full test suite only when the touched behavior is shared.

Good context budget rule: for a normal bug or feature, aim to inspect under ten source files before editing. Break that rule only when the code path genuinely crosses API, worker, Prisma, and web3 boundaries.

## Architecture Constraints

- This is a NestJS 11 TypeScript backend with strict TypeScript enabled.
- Runtime mode is selected by `SERVICE`; do not introduce a second entrypoint unless there is a strong reason.
- Redis is the Nest microservice transport. Postgres is the source of truth.
- Prisma client output is `generated/prisma`; imports should stay consistent with existing code.
- GraphQL schema is decorator-driven and emitted to `src/schema.gql`.
- On-chain integrations use `viem`; avoid mixing in another EVM library.

## Domain Invariants

Be especially careful with these areas:

- Contract scanning advances block cursors. Do not move cursor updates earlier than successful processing.
- Copy-trading actions need idempotency. Preserve dedupe keys, unique constraints, and `ActionProcessing` semantics.
- Wallet writes are serialized by account/chain in `EvmChainsService.writeWithMutex`. Do not bypass that path for transactions.
- Read-heavy RPC calls are throttled by chain/priority semaphores. Keep new bulk reads behind the existing adapter/service layer.
- Simulations are historical and database-heavy. Prefer resumable, idempotent progress updates over in-memory-only state.
- Seeded contracts may be `Dead`; workers intentionally filter for live contracts.

## Adding Features

For a new GraphQL API feature:

1. Add or update the module's `dto`, `entities`, service, and resolver.
2. Use `PrismaService` for database access.
3. Keep authorization patterns aligned with neighboring resolvers.
4. Build the project and refresh `src/schema.gql` if GraphQL decorators changed.

For a new platform or event version:

1. Add ABI/config/parser code under `src/web3/platform/<platform>/<version>`.
2. Wire it through `src/web3/utils.ts`.
3. Add contract seed data or migration data only when needed.
4. Verify both leaderboard conversion and copy-trading action parsing.

For schema changes:

1. Edit `prisma/schema.prisma`.
2. Create a migration.
3. Regenerate the Prisma client.
4. Update GraphQL entities and services in the same change.

## Testing Notes

- Unit tests are discovered under `src` by `*.spec.ts`.
- E2E tests use `test/jest-e2e.json`.
- The current e2e sample is stale because it imports `AppModule` from `api.module`, while the module exports `ApiModule`.
- For worker logic, prefer focused service tests around pure routing, parser, and idempotency behavior before attempting live RPC tests.

## Style

- Follow existing Nest module/service/resolver structure.
- Use `src/...` absolute imports where the repo already does.
- Prefer explicit domain names over generic helpers.
- Keep comments rare and useful, especially around non-obvious trading or chain logic.
- Do not add broad abstraction layers unless they remove real duplication across platforms or modules.

## Safety Defaults

- Avoid running live worker services unless the user explicitly wants that.
- Do not change `.env` secrets.
- Do not run destructive Prisma commands against a configured database.
- Do not broaden RPC calls or scheduled cron frequency casually.
- Mention stale tests, missing env, or unavailable services in your final note when they affect verification.
