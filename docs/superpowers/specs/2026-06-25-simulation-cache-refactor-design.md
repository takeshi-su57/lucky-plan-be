# Simulation Cache Refactor Design

## Goal

Improve simulation detail read performance by replacing read-time recomputation with persisted cache tables that:

- return current built data immediately
- rebuild asynchronously after reads
- skip rebuild work for completed simulation bots
- preserve correctness when positions opened during a bot lifetime close after the bot stops accepting new positions

## Problem

Current simulation detail reads are expensive because they rebuild plan and bot analytics from `PerpTradingEventLog` on demand. The hot path:

- queries raw event logs per simulation bot
- parses `jsonLog` rows repeatedly
- reconstructs positions and follower PnL in Node
- recomputes plan totals during user reads

This becomes especially expensive for:

- `getSimulationPlanById`
- `simulationPlanDetailsBySimulation`

The current `SimulationBot` and `SimulationPlan` tables also hold denormalized analytics fields, which mixes lifecycle/configuration state with derived read-model state.

## Constraints

- `PerpTradingEventLog` remains the source of truth.
- Existing `PerpTradingEventLog` indexes must not be removed blindly because other use cases query by `contractId` and sometimes by `platform`.
- Bot completion cannot be determined by `stoppedAt` alone.
- A bot is only complete when every position opened during its active lifetime is closed in the fetched log set.
- Reads should return immediately with the latest persisted cache state.
- Rebuilds must be idempotent and safe to repeat.
- Rollout should keep current denormalized columns temporarily for parity checks and fallback.

## Proposed Data Model

### Keep `SimulationBot` as config and lifecycle state

`SimulationBot` remains responsible for:

- identity
- `simulationPlanId`
- `leaderAddress`
- `leaderContractId`
- `startedAt`
- `stoppedAt`
- `mode`
- `ratio`
- `maxLeverage`

Existing denormalized analytics columns stay temporarily during rollout, but they stop being the primary read source.

### Keep `SimulationPlan` as plan identity and window state

`SimulationPlan` remains responsible for:

- identity
- title and description
- `startAt`
- `endAt`
- `cursor`
- `simulationId`

Existing denormalized plan analytics columns stay temporarily during rollout, but they stop being the primary read source.

### Add `SimulationBotCache`

One active cache row per simulation bot.

Responsibilities:

- current computed bot analytics
- rebuild state
- completion state
- fetch progress
- last rebuild error

Suggested fields:

- `id`
- `simulationBotId` unique
- `completed`
- `rebuilding`
- `rebuildRequested`
- `lastFetchedAt`
- `openedPositions`
- `totalPositions`
- `totalLeaderPnl`
- `totalFollowerPnl`
- `maxDuration`
- `avgDuration`
- `avgPnl`
- `avgPositivePnl`
- `avgNegativePnl`
- `avgSize`
- `avgCollateral`
- `avgPnlPercentageBySize`
- `avgPnlPercentageByCollateral`
- `avgLeverage`
- `lastError`
- `createdAt`
- `updatedAt`

### Add `SimulationBotCachedEventLog`

Raw copied event-log rows for one bot cache.

Responsibilities:

- persist fetched `PerpTradingEventLog` rows relevant to one bot
- support incremental rebuild without re-reading the full source table for every detail query
- provide a durable bot-local event set for correctness checks

Suggested fields:

- `id`
- `simulationBotCacheId`
- `sourceEventLogId`
- `contractId`
- `address`
- `platform`
- `block`
- `logIndex`
- `date`
- `jsonLog`
- `usdPnl`
- `createdAt`

Suggested indexes:

- unique on `[simulationBotCacheId, sourceEventLogId]`
- index on `[simulationBotCacheId, date, block, id]`

### Add `SimulationPlanCache`

One active cache row per simulation plan.

Responsibilities:

- plan-level rollup derived from bot caches
- track whether all bots in the plan are complete
- serve as the immediate read source for plan details

Suggested fields:

- `id`
- `simulationPlanId` unique
- `completed`
- `rebuilding`
- `completedBots`
- `incompleteBots`
- `openedPositions`
- `totalPositions`
- `totalLeaderPnl`
- `totalFollowerPnl`
- `lastBuiltAt`
- `lastError`
- `createdAt`
- `updatedAt`

## Completion Semantics

`SimulationBotCache.completed = true` means:

- every position whose open event occurred during the bot active lifetime has a matching close event in the cached raw logs

Bot active lifetime means:

- open event date is `>= startedAt`
- if `stoppedAt` exists, open event date is `<= stoppedAt`

Important consequence:

- the rebuild process may need to fetch logs beyond `stoppedAt`
- if a position opened during bot lifetime remains open as of the latest fetched log, the cache remains incomplete

`SimulationPlanCache.completed = true` means:

- every bot cache in the plan is completed

## Read Flow

### `getSimulationPlanById`

Behavior:

- return persisted `SimulationPlanCache` and `SimulationBotCache` data immediately
- do not recompute analytics inline before responding
- trigger asynchronous refresh after response when needed

Refresh conditions:

- bot cache missing
- `completed = false`
- `rebuildRequested = true`

### `simulationPlanDetailsBySimulation`

Behavior:

- return current persisted cache-backed details for all plans immediately
- do not recalculate every plan in parallel during the request
- trigger async refresh only for plans containing incomplete or missing bot caches

## Rebuild Flow

### Bot cache rebuild

1. Load `SimulationBot`, `SimulationBotCache`, and existing `SimulationBotCachedEventLog` rows.
2. Determine the fetch start point:
   - if cache has no copied logs, start from `startedAt`
   - otherwise fetch from just after the latest cached source event
3. Fetch new source rows from `PerpTradingEventLog` for the bot leader and contract.
4. Copy only uncached source rows into `SimulationBotCachedEventLog`.
5. Recompute the full bot analytics from all cached raw rows.
6. Re-evaluate whether all positions opened during bot lifetime are closed.
7. Update `SimulationBotCache` with:
   - analytics
   - `completed`
   - `lastFetchedAt`
   - `rebuilding = false`
   - cleared or updated `lastError`

Important rule:

- recomputation uses the bot-local cached raw event set, not only the newly fetched rows

This keeps correctness simpler and avoids drift from partial incremental math.

### Plan cache rebuild

After one or more bot cache rebuilds finish:

1. Load all bot caches for the plan.
2. Roll up plan totals from bot caches.
3. Count completed and incomplete bots.
4. Update `SimulationPlanCache`.

Plan cache never reads raw source event logs directly.

## API Shape Changes

The API should start reading computed analytics from cache-backed structures rather than directly from `SimulationBot` and `SimulationPlan` denormalized columns.

Implementation options:

- keep GraphQL entity shapes mostly stable and source the values from cache internally
- or introduce explicit cache-backed entities and migrate callers

Recommendation:

- keep the outward GraphQL shape as stable as possible during rollout
- change service internals first

This minimizes frontend impact while the backend behavior shifts.

## Rollout Plan

### Phase 1: additive schema

- add `SimulationBotCache`
- add `SimulationBotCachedEventLog`
- add `SimulationPlanCache`
- keep existing denormalized columns on `SimulationBot` and `SimulationPlan`

### Phase 2: write and backfill

- create cache rows when plans and bots are created
- implement rebuild services
- backfill caches for existing simulations

### Phase 3: switch reads

- make simulation detail queries read from cache tables
- trigger async rebuild for incomplete or missing caches
- keep old denormalized columns populated temporarily if useful for parity checks

### Phase 4: verify parity

- compare old and new calculations on selected plans
- validate incomplete-to-complete transitions
- validate positions closed after `stoppedAt`

### Phase 5: cleanup

- remove denormalized analytics columns from `SimulationBot`
- remove denormalized analytics columns from `SimulationPlan`
- remove old read-time rebuild path

## Quality Improvements

This design improves code quality by separating:

- source-of-truth trading logs
- simulation lifecycle/configuration state
- simulation read-model/cache state

Benefits:

- faster reads
- smaller hot request path
- clearer ownership of derived analytics
- easier correctness reasoning around incomplete positions
- selective rebuild by bot instead of full-plan or full-simulation recomputation

## Failure Handling

- If rebuild fails, preserve the last good cache data.
- Record the failure in `lastError`.
- Clear `rebuilding` on failure.
- Subsequent reads still return cached data immediately.
- Incomplete or errored caches may be retried later by read-triggered or scheduled rebuild.

## Concurrency Rules

- A bot cache with `rebuilding = true` should not start a duplicate rebuild.
- Rebuild operations must be idempotent.
- Copying raw source logs must dedupe by source event identity.
- Plan cache rebuild may run after bot rebuild completion and should tolerate concurrent requests.

## Verification

Minimum verification scenarios:

- positions opened and closed within bot lifetime
- positions opened during bot lifetime and closed after `stoppedAt`
- positions still open at the latest available event log
- multiple positions per bot
- reversed mode follower PnL
- ratio-scaled follower PnL
- repeated detail reads while rebuild is already running
- plan rollups with mixed completed and incomplete bots

## Out of Scope

- changing or removing existing `PerpTradingEventLog` indexes in this refactor
- versioned cache snapshots
- changing `PerpTradingEventLog` as source of truth
- broad GraphQL schema redesign unrelated to simulation performance
