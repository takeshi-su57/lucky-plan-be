# Automatic Simulation Spec

## Purpose

This document specifies a backend-first automatic simulation layer for the existing copy-trading simulation system.

The goal is to use the current simulation mechanism more systematically so we can find evidence about:

- Which leaders are worth copying.
- Which leaders may be stable negative-edge traders.
- Whether reverse-copying those leaders with realistic position sizing can produce positive net PnL.
- Which position sizing settings are worth testing further.

This is not a rewrite of the current simulation system. The automatic simulation should reuse `SimulationPlan` and `SimulationBot` as the daily executable simulation units.

## Confirmed Direction

The automatic simulation introduces one parent model:

```text
Simulation
```

`Simulation` wraps many `SimulationPlan` records.

One `Simulation` can cover a longer date range, for example:

```text
2026-04-01 -> 2026-05-01
```

When the user clicks `playAutoSimulation`, the backend runs through the date range day by day.

For each day:

1. Create one daily `SimulationPlan`.
2. Detect and score candidate leaders for that day.
3. Store scoring logs for selected leaders only.
4. Create `SimulationBot` records for selected leaders.
5. Run the existing simulation-plan detail logic.
6. Store or aggregate the result back into the parent `Simulation`.

`playAutoSimulation` should run in the background. The mutation should accept the run, update the parent `Simulation` status/progress, and return quickly.

Daily bots should set `startedAt` to the daily window start and `stoppedAt` to the daily window end. Existing simulation code uses `stoppedAt` to stop opening new positions after the daily window, while still allowing later consequence actions for positions that were opened during the window.

This keeps daily results compatible with the normal simulation-plan workflow.

## Backend First Scope

The first version should focus on backend behavior.

Frontend scope is intentionally small:

- The simulation detail page can show a `Play Auto Simulation` button.
- The button calls the backend mutation.
- The page can show parent `Simulation.status`, cursor, and progress fields.
- Rich task/window/leader management UI is not required for the first version.

The important thing is that the generated daily `SimulationPlan`s remain normal simulation plans, so existing UI and GraphQL queries can inspect them.

## Current Repo Context

Relevant existing models:

- `SimulationPlan`
- `SimulationBot`
- `PerpTradingEventLog`
- `Contract`
- live execution models such as `Plan`, `Bot`, `Mission`, `Task`, `Action`, and `FollowerAction`

The current simulation detail flow is in:

```text
src/microservices/apiService/modules/simulations/simulations.service.ts
```

Important existing behavior:

- `SimulationPlan` has `startAt`, `endAt`, and `cursor`.
- `SimulationBot` has `leaderAddress`, `leaderContractId`, `startedAt`, `stoppedAt`, `mode`, `ratio`, and `maxLeverage`.
- `getSimulationPlanById` queries historical `PerpTradingEventLog`.
- Historical logs are converted into normalized trade histories through `getWeb3Info(...).eventToPerpTradeHistory(...)`.
- Histories are grouped with `EventLogsService.convertToPerpTradePositionsWithSummary(...)`.
- Reverse mode already exists through `BotMode.Reversed`.

Important implementation note:

- The current simulation detail path should be reused as much as possible.
- If extracting reusable helper functions is needed, keep the extraction small and local to the simulations module.

## Proposed Data Model

Add a parent `Simulation` model.

Add an optional `simulationId` to `SimulationPlan`.

```prisma
model Simulation {
  id          Int      @id @default(autoincrement())
  title       String
  description String

  platform    Platform

  startAt     DateTime
  endAt       DateTime
  cursor      DateTime?
  status      SimulationStatus @default(Created)
  progressPhase String?
  progressMessage String?
  progressPercent Float @default(0)

  selectedLeaderCount Int   @default(10)
  minTrades           Int   @default(3)
  minNegativeR2       Float @default(0.25)

  standardCollateralUsd Float @default(100)
  minCollateralUsd      Float @default(10)
  maxCollateralUsd      Float @default(500)
  minRatio              Float @default(0.05)
  maxRatio              Float @default(3)
  maxLeverage           Float @default(50)

  openFeeRate  Float @default(0)
  closeFeeRate Float @default(0)
  slippageRate Float @default(0)
  totalSimulationPlans Int   @default(0)
  completedPlans       Int   @default(0)
  totalLeaderPnl       Float @default(0)
  totalFollowerPnl     Float @default(0)
  totalNetPnlUsd       Float @default(0)
  totalCostUsd         Float @default(0)
  maxDrawdownUsd       Float @default(0)
  tradeCount           Int   @default(0)
  winRate              Float @default(0)
  profitFactor         Float @default(0)

  error       String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  simulationPlans SimulationPlan[]
  leaderSelections SimulationLeaderSelection[]
}

model SimulationPlan {
  simulationId Int?
  simulation   Simulation? @relation(fields: [simulationId], references: [id])
}

model SimulationLeaderSelection {
  id               Int @id @default(autoincrement())
  simulationId     Int
  simulationPlanId Int?
  leaderAddress    String @db.VarChar(255)
  date              DateTime

  score             Float @default(0)
  suggestedRatio    Float @default(0)
  suggestedCollateralUsd Float @default(0)
  rawTotalPnlUsd    Float @default(0)
  rawSlope          Float @default(0)
  rawR2             Float @default(0)
  rawTradeCount     Int @default(0)
  reverseNetPnlUsd  Float @default(0)
  reverseDrawdownUsd Float @default(0)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  simulation Simulation @relation(fields: [simulationId], references: [id], onDelete: Cascade)
  simulationPlan SimulationPlan? @relation(fields: [simulationPlanId], references: [id])

  @@unique([simulationPlanId, leaderAddress])
  @@index([simulationId, date])
  @@index([leaderAddress])
}

enum SimulationStatus {
  Created
  Running
  Paused
  Completed
  Failed
  Cancelled
}
```

Prisma notes:

- `simulationId Int?` keeps old/manual simulation plans valid.
- `SimulationPlan` remains the normal inspectable unit.
- `SimulationLeaderSelection` stores selected leader scoring logs only. Rejected candidates are not stored in the first version.
- `SimulationLeaderSelection` is platform-scoped, not contract-scoped. The selected leader is later expanded into one `SimulationBot` per available platform contract.
- The exact field names can be adjusted to match current naming style, but the relationship should stay `Simulation 1 -> many SimulationPlan`.
- If a `Simulation` model name conflicts with existing generated Prisma enum names or GraphQL names, use `AutoSimulation` instead.

## Selection Log Storage

The first version stores selected leader scoring logs only.

Rejected candidates are used during daily ranking but are not persisted.

Reasoning:

- Keeps schema small.
- Preserves the leaders that actually became `SimulationBot`s.
- Avoids creating a large rejected-candidate audit table before the analysis UI needs it.

If rejected-leader debugging becomes important later, add a separate debug/audit table or a JSON debug artifact.

## Background Progress

`playAutoSimulation` should be accepted as a background run.

The mutation should:

1. Validate that the `Simulation` is not already running.
2. Set `status = Running`.
3. Set initial progress fields on `Simulation`.
4. Start background processing.
5. Return the updated `Simulation` quickly.

Minimum progress fields on `Simulation`:

- `status`
- `cursor`
- `progressPhase`
- `progressMessage`
- `progressPercent`
- `completedPlans`
- `totalSimulationPlans`
- `error`

The first version should not store progress history rows. Latest status/progress on `Simulation` is enough.

The old `SimulationProgressLog` table existed in older migrations but was later dropped, so this spec does not assume reusable persisted progress logs.

## GraphQL API

### Mutations

```graphql
createSimulation(input: CreateSimulationInput!): Simulation!
updateSimulation(input: UpdateSimulationInput!): Simulation!
playAutoSimulation(id: Int!): Simulation!
cancelSimulation(id: Int!): Simulation!
deleteSimulation(id: Int!): Int!
```

`playAutoSimulation` is the important first mutation.

It should:

- Load the parent `Simulation`.
- Return quickly after accepting the background run.
- Run from `simulation.cursor ?? simulation.startAt`.
- Create daily `SimulationPlan`s as it advances.
- Add selected `SimulationBot`s to each plan.
- Reuse normal simulation calculation.
- Update parent progress and aggregate fields as it runs.

`cancelSimulation` should set a cancellation signal on the parent `Simulation` if the background runner can check it between daily plans. If cancellation cannot be implemented safely in the first pass, expose it only after it is reliable.

### Queries

```graphql
simulations(first: Int!, after: Int): SimulationConnection!
simulation(id: Int!): Simulation
simulationPlansBySimulation(simulationId: Int!): [SimulationPlan!]!
```

```graphql
simulationLeaderSelections(simulationId: Int!, simulationPlanId: Int): [SimulationLeaderSelection!]!
```

## Create Input

```graphql
input CreateSimulationInput {
  title: String!
  description: String!

  platform: Platform!

  startAt: Date!
  endAt: Date!

  selectedLeaderCount: Int = 10
  minTrades: Int = 3
  minNegativeR2: Float = 0.25

  standardCollateralUsd: Float = 100
  minCollateralUsd: Float = 10
  maxCollateralUsd: Float = 500
  minRatio: Float = 0.05
  maxRatio: Float = 3
  maxLeverage: Float = 50

  openFeeRate: Float = 0
  closeFeeRate: Float = 0
  slippageRate: Float = 0
}
```

Validation:

- `startAt < endAt`.
- `minCollateralUsd <= standardCollateralUsd <= maxCollateralUsd`.
- `minRatio <= maxRatio`.
- `maxLeverage > 0`.
- Cost rates must be non-negative.
- `Simulation` is platform-scoped only. Chain and contract details belong to generated `SimulationBot` rows.
- Leader selection is platform-scoped. Do not filter candidate discovery or scoring by contract.

## Daily Run Flow

For one parent `Simulation`:

```text
currentDay = simulation.cursor ?? simulation.startAt

while currentDay < simulation.endAt:
  dayStart = currentDay
  dayEnd = min(currentDay + 1 day, simulation.endAt)

  create SimulationPlan(dayStart, dayEnd, simulationId, cursor = current time)
  find candidate leaders from PnlSnapshotV2 using platform and dateStr
  prefilter candidates using latest pre-day activity
  score candidates using only data before dayStart
  select top leaders
  create SimulationBot rows for selected leaders across available platform contracts
    startedAt = dayStart
    stoppedAt = dayEnd
  run normal simulation detail calculation for this plan
  aggregate daily result into parent Simulation
  update simulation.cursor = dayEnd
  currentDay = dayEnd
```

Use half-open date ranges:

```text
dayStart <= event.date < dayEnd
```

This avoids double-counting events at daily boundaries.

## Candidate Discovery

Candidates come from `PnlSnapshotV2`. This table is the daily platform leaderboard used to find potential losing leaders before parsing full event history.

Filter:

- `platform = simulation.platform`
- `dateStr = format(dayStart, 'YYYY-MM-DD')`
- `accUSDPnl <= -50`

Candidate ordering:

1. Sort by `accUSDPnl` ascending, so the minimum accumulated PnL is evaluated first.
2. Sort by `address` ascending as a stable tie-breaker.

Candidate discovery must not apply a candidate limit. `selectedLeaderCount` only limits how many scored leaders become simulation bots after evaluation.

Before scoring, prefilter candidates by reading the latest real `PerpTradingEventLog` records before `dayStart`:

- `platform = simulation.platform`
- `address = candidate address`
- `date < dayStart`
- order by newest first
- take at most 50 logs per candidate

Reject the candidate if:

- fewer than `simulation.minTrades` closed positions can be built from the sampled logs
- the latest log is older than 30 days before `dayStart`

## Candidate Scoring

For each candidate:

1. Load the candidate's historical logs with no beginning limit and `date < dayStart`.
2. Convert logs to normalized histories.
3. Group histories into positions with the existing event log service.
4. Keep only positions that are closed before `dayStart`.
5. Calculate raw leader metrics from closed positions.
6. Estimate reverse-copy result from closed positions.
7. Calculate score.
8. Suggest ratio and collateral.
9. Persist a `SimulationLeaderSelection` row only if the candidate is selected.

Raw leader metrics:

- total closed-position PnL
- slope of cumulative closed-position PnL
- R2 of cumulative closed-position PnL
- max drawdown
- closed position count
- win rate
- average position PnL
- average maximum deposited amount
- average leverage
- worst position

Reject candidate from selection if:

- `closedPositionCount < minTrades`
- raw slope is not negative
- raw R2 is below `minNegativeR2`
- average maximum deposited amount is too small
- histories cannot be parsed
- data is incomplete enough to make the result misleading

Rejected candidates are not persisted in the first version.

Opened positions during leader validation are excluded from scoring. They do not have a complete realized outcome before `dayStart`, so including them would mix incomplete PnL into the walk-forward evidence. Runtime simulation still allows positions opened during the daily bot window to receive later consequence actions.

## Reverse Simulation Approximation

Important assumption:

Bad traders may lose because of bad management, not only wrong direction.

So the score should use simulated reverse follower result, not just `leaderPnl * -1`.

First version can use the current simulation-style approximation:

- Reverse direction.
- Preserve event timing and position lifecycle.
- Scale collateral and size by suggested ratio.
- Respect max leverage.
- Calculate one sample per closed position.
- Position size is the maximum deposited amount observed across the position lifecycle, including increase/decrease and leverage increase/decrease histories.
- Position PnL is accumulated from all histories in the position.
- Trading fees and configured cost assumptions are applied at the position level.
- Apply min/max collateral.
- Apply explicit fee and slippage model.

The approximation should be named clearly in code:

```ts
simulateReverseCopyApproximation(...)
```

Add a TODO:

```ts
// TODO: Replace this approximation with event-level reverse lifecycle simulation
// when the normalized history model exposes enough fill and close semantics.
```

Implementation warning:

- The current detail code appears to set `bot.ratio = 1` inside the history loop.
- Auto simulation must preserve the selected/suggested ratio.

## Position Sizing

Use score-driven position sizing:

```ts
suggestedCollateralUsd = clamp(
  standardCollateralUsd * score,
  minCollateralUsd,
  maxCollateralUsd,
)

suggestedRatio = clamp(
  suggestedCollateralUsd / Math.max(leaderAvgCollateralUsd, 1),
  minRatio,
  maxRatio,
)
```

Then create `SimulationBot` with:

```text
mode = Reversed
ratio = suggestedRatio
maxLeverage = simulation.maxLeverage
startedAt = daily SimulationPlan.startAt
stoppedAt = daily SimulationPlan.endAt
```

For each selected leader, create simulation bots for all available contracts on the selected platform.

Contract behavior:

- The parent `Simulation` stores only `platform`.
- Leader selection and scoring use the single selected platform only.
- Candidate selection should not be narrowed by contract.
- After a leader is selected, create one `SimulationBot` per available `Contract` row with matching `platform`.
- Do not filter available contracts by chain in v1. For example, if `GNS` has Arbitrum, Base, and Polygon contracts, a selected GNS leader should produce bots for all available GNS contracts.
- Each created bot uses that contract's `id` as `leaderContractId`.

Set `stoppedAt` to the daily plan end for auto-generated bots.

Rationale:

- The bot may only open copied positions during `[dayStart, dayEnd]`.
- A position can remain open after the day it started.
- The simulation should fetch and evaluate from bot `startedAt` to the current plan cursor/present simulation point.
- Existing `stoppedAt` handling prevents new positions after `dayEnd` while preserving later actions for positions opened during the daily window.

## Cost Model

Each reverse result should calculate:

```text
grossPnlUsd
openFeeUsd
closeFeeUsd
slippageUsd
totalCostUsd
netPnlUsd = grossPnlUsd - totalCostUsd
```

Suggested formulas:

```ts
openFeeUsd = openedNotionalUsd * openFeeRate
closeFeeUsd = closedNotionalUsd * closeFeeRate
slippageUsd = tradedNotionalUsd * slippageRate
totalCostUsd = openFeeUsd + closeFeeUsd + slippageUsd
netPnlUsd = grossPnlUsd - totalCostUsd
```

Gas cost is ignored in v1.

## Score Formula

Score should be between `0` and `1`.

Suggested components:

- reverse trend score
- raw negative-edge score
- sample score
- drawdown score
- profit factor score
- cost efficiency score
- concentration penalty

Suggested formula:

```ts
score =
  reverseTrendScore * 0.35 +
  rawNegativeEdgeScore * 0.20 +
  sampleScore * 0.15 +
  drawdownScore * 0.15 +
  profitFactorScore * 0.10 +
  costEfficiencyScore * 0.05

score = clamp(score, 0, 1) * concentrationPenalty
```

Keep this in a pure helper module so it can be tested.

## Reuse Existing SimulationPlan Logic

The automatic simulation should reuse current simulation calculations.

Recommended refactor:

Extract the per-plan calculation from `getSimulationPlanById` into a method such as:

```ts
calculateSimulationPlanDetails(id: number): Promise<SimulationPlanDetails>
```

Then:

- `getSimulationPlanById` calls this method.
- `playAutoSimulation` calls this method after creating daily bots.

This avoids duplicating follower-history simulation logic.

## Aggregation

After each daily `SimulationPlan` calculation:

- Read daily `totalLeaderPnl`.
- Read daily `totalFollowerPnl`.
- Aggregate total PnL into parent `Simulation`.
- Aggregate trade count, win rate, profit factor, cost, and drawdown if available.
- Keep selected leader scoring logs in `SimulationLeaderSelection`.
- Do not store rejected leader logs in the first version.

## Future Frontend Overview Charts

This is frontend-facing and is not part of the backend-first v1 implementation. Keep it here only as future UI/reporting direction.

The frontend can render two overview chart modes from backend data.

### Daily Plan Overview

Render one row/point per generated `SimulationPlan`, ordered by `startAt`.

Useful charts:

- Bar chart of daily follower PnL.
- Bar chart of daily leader PnL.
- Accumulated line chart of follower PnL.
- Accumulated line chart of leader PnL.

This view can be built from `simulationPlansBySimulation(simulationId)` without new per-event storage.

### Detailed Follower Overview

Render a single combined chart from all generated simulation plans.

Process:

1. Load all `SimulationPlan`s for the parent `Simulation`.
2. For each plan, load plan details with its `SimulationBot`s.
3. Aggregate every simulated follower position/history across all plans and bots.
4. Sort all follower histories chronologically.
5. Build a single follower PnL/equity line chart.

This gives a whole-simulation view instead of only day-by-day summaries.

Important:

- The combined chart should use follower histories, not only `SimulationPlan.totalFollowerPnl`.
- If the same open position appears across multiple plan detail calculations, the aggregation layer must avoid double-counting. The first implementation should identify histories by stable fields such as `contractId`, `positionKey`, original leader history id, operation, and date.
- If exact de-duplication is not possible yet, document the approximation clearly in the chart response.

Possible future backend helper:

```ts
getSimulationOverview(simulationId: number): Promise<SimulationOverview>
```

GraphQL can expose this later as:

```graphql
simulationOverview(simulationId: Int!): SimulationOverview!
```

## No-Look-Ahead Rule

Every daily plan must use only that day's data.

Correct:

```ts
date: {
  gte: dayStart,
  lt: dayEnd,
}
```

Avoid:

```ts
date: {
  lte: dayEnd,
}
```

because it can double-count boundary events.

## Testing Plan

Backend tests:

- Create simulation with params.
- `playAutoSimulation` creates daily simulation plans.
- Daily plans have correct `simulationId`.
- Daily plans use one-day periods.
- Candidate discovery uses `gte dayStart` and `lt dayEnd`.
- Candidate discovery filters by platform only, not by contract.
- Event exactly at `dayEnd` is excluded from the current day.
- Selected leaders create `SimulationBot` rows.
- Selected leaders create one `SimulationBot` per available platform contract.
- Simulation bots use `BotMode.Reversed`.
- Suggested ratio is preserved.
- Daily simulation bots are not automatically force-stopped at the day end.
- Parent simulation aggregates completed daily plans.
- Selected leaders create `SimulationLeaderSelection` rows.
- Rejected leaders do not create `SimulationLeaderSelection` rows.
- Existing manual `SimulationPlan` without `simulationId` still works.

Pure helper tests:

- Score stays between `0` and `1`.
- Position size clamps collateral.
- Position size clamps ratio.
- Cost model subtracts open fees, close fees, and slippage.
- Cost model ignores gas in v1.
- Profit factor handles zero-loss and zero-profit cases.
- Max drawdown handles monotonic up/down and mixed equity curves.

## Example GraphQL

Create:

```graphql
mutation CreateSimulation($input: CreateSimulationInput!) {
  createSimulation(input: $input) {
    id
    title
    status
    startAt
    endAt
  }
}
```

Play:

```graphql
mutation PlayAutoSimulation($id: Int!) {
  playAutoSimulation(id: $id) {
    id
    status
    cursor
    progressPhase
    progressMessage
    progressPercent
    completedPlans
    totalSimulationPlans
    totalFollowerPnl
    totalNetPnlUsd
  }
}
```

Query:

```graphql
query SimulationDetails($id: Int!) {
  simulation(id: $id) {
    id
    title
    status
    cursor
    progressPhase
    progressMessage
    progressPercent
    totalSimulationPlans
    completedPlans
    totalLeaderPnl
    totalFollowerPnl
    totalNetPnlUsd
    maxDrawdownUsd
    tradeCount
    winRate
    profitFactor
  }
  simulationPlansBySimulation(simulationId: $id) {
    id
    title
    startAt
    endAt
    totalLeaderPnl
    totalFollowerPnl
    totalPositions
  }
}
```

Overview:

```graphql
query SimulationOverview($id: Int!) {
  simulationOverview(simulationId: $id) {
    dailyPlans {
      simulationPlanId
      startAt
      endAt
      leaderPnl
      followerPnl
      accumulatedLeaderPnl
      accumulatedFollowerPnl
    }
    followerEquity {
      date
      pnl
      accumulatedPnl
    }
  }
}
```

## Implementation Milestones

1. Add `Simulation` model and optional `SimulationPlan.simulationId`.
2. Add `SimulationLeaderSelection` for selected leader scoring logs.
3. Add GraphQL entity/input/resolver methods for create/update/query simulation.
4. Add pure scoring, cost, sizing, and date-window helpers.
5. Extract reusable simulation-plan calculation from `getSimulationPlanById`.
6. Implement background `playAutoSimulation` to create daily plans and bots.
7. Update parent progress and aggregate summary during the run.
8. Add simulation overview aggregation for daily plan charts and combined follower-position charts.
9. Add backend tests.
10. Add minimal frontend button and query wiring.

## Decisions Needed

Before implementation, confirm:

No open backend spec decisions at this point.
