# Simulation Research Grid Search Spec

## Goal

Add a new `research` layer above the current auto simulation flow so one user input can generate a grid of concrete simulations and help compare parameter sets for the same title, description, duration, and direction.

The target hierarchy becomes:

```text
Research -> Simulations -> SimulationPlans -> SimulationBots
```

## Current State

Today the system has three levels:

- `simulationBot`: a single bot executing inside a time-bounded simulation plan
- `simulationPlan`: a daily or manual plan that groups simulation bots
- `simulation`: an auto-simulation template that selects bots daily and creates simulation plans automatically

The current auto-simulation configuration is too narrow:

- `title`
- `description`
- `duration`
- `minTrades`
- `minNegativeR2`
- `maxLeverage`

The current selection logic also assumes every selected bot is `Reversed`.

## New Product Behavior

### 1. Introduce Research

Users create a `research` instead of creating a single auto simulation directly.

The research stores:

- `title`
- `description`
- `platform`
- `duration`
- `direction`
- `minTrades` range: `min`, `max`, `gap`
- `maxTrades` range: `min`, `max`, `gap`
- `minR2` range: `min`, `max`, `gap`
- `maxR2` range: `min`, `max`, `gap`
- `minSlope` range: `min`, `max`, `gap`
- `maxSlope` range: `min`, `max`, `gap`
- `maxLeverage` range: `min`, `max`, `gap`

When research is created, the backend expands every range and builds every valid parameter combination automatically.

Each valid combination creates one concrete `simulation`.

### 2. Validity Rules

For each generated simulation:

- `minTrades <= maxTrades`
- `minR2 <= maxR2`
- `minSlope <= maxSlope`

If a pair violates a rule, that combination is skipped.

### 3. Direction

Each simulation has a concrete direction:

- `Default`
- `Reversed`

Direction affects both bot mode and slope-sign normalization.

The research form accepts **absolute** slope values for `minSlope` and `maxSlope`.

Normalization rules:

- `Default`
  - stored simulation `minSlope` stays positive
  - stored simulation `maxSlope` stays positive
- `Reversed`
  - stored simulation `minSlope = -abs(maxSlopeInput)`
  - stored simulation `maxSlope = -abs(minSlopeInput)`

Example:

```text
input minSlope = 1
input maxSlope = 3
direction = Reversed

stored simulation minSlope = -3
stored simulation maxSlope = -1
```

This preserves the invariant `minSlope <= maxSlope`.

### 4. Expanded Simulation Params

Each concrete simulation now uses:

- `direction`
- `minTrades`
- `maxTrades`
- `minR2`
- `maxR2`
- `minSlope`
- `maxSlope`
- `maxLeverage`

Existing `selectedLeaderCount` and `standardCollateralUsd` can remain as system defaults for now.

### 5. Selection / Evaluation Logic

Leader evaluation becomes direction-aware.

For a candidate leader:

- raw trade count must be within `[minTrades, maxTrades]`
- raw `r2` must be within `[minR2, maxR2]`
- raw `slope` must be within `[minSlope, maxSlope]`

Copy approximation also becomes direction-aware:

- `Default`: simulate normal copy behavior
- `Reversed`: simulate reversed copy behavior

The selected bot mode for created simulation bots must match the simulation direction.

## Data Model Changes

### New model: `SimulationResearch`

Responsibilities:

- own the original research metadata
- own the input ranges
- group concrete simulations

Suggested fields:

```text
id
title
description
platform
startAt
endAt
direction
minTradesMin / Max / Gap
maxTradesMin / Max / Gap
minR2Min / Max / Gap
maxR2Min / Max / Gap
minSlopeMin / Max / Gap
maxSlopeMin / Max / Gap
maxLeverageMin / Max / Gap
createdAt
updatedAt
```

### Update model: `Simulation`

Add:

```text
researchId?
direction
maxTrades
minR2
maxR2
minSlope
maxSlope
```

Keep existing fields that are still useful to the current runner:

- `platform`
- `startAt`
- `endAt`
- `selectedLeaderCount`
- `standardCollateralUsd`
- `maxLeverage`
- existing progress/result fields

## Backend API Changes

### New mutation

`createSimulationResearch(input)`

Behavior:

1. validate ranges
2. create one `SimulationResearch`
3. expand the parameter grid
4. create one `Simulation` per valid combination
5. return the research summary

### New queries

- `simulationResearches(first, after)`
- `simulationResearch(id)`
- `simulationsByResearch(researchId)`

### Existing simulation queries

Keep existing simulation detail queries so current auto-simulation detail pages can continue to show:

- concrete simulation progress
- generated daily plans
- plan-level overview

## Frontend Changes

### Research Creation Panel

Replace the current auto-simulation create form with a research form:

- title
- description
- platform
- duration
- direction
- range triplets for every parameter

Validation must surface the pair rules clearly:

- Min Trades range can generate only simulations where `minTrades <= maxTrades`
- Min R2 range can generate only simulations where `minR2 <= maxR2`
- Min Slope range can generate only simulations where `minSlope <= maxSlope`

### Research List

The main `/simulations` page should show research rows first, not concrete auto simulations.

Each row should summarize:

- title / description
- direction
- duration
- total generated simulations
- completed simulations

### Research Detail

Research detail shows:

- research metadata
- configured search ranges
- child simulations list

Each child simulation row can reuse the current simulation row / detail flow.

## Non-Goals For This Step

- changing the manual simulation plan flow
- changing simulation cache architecture
- redesigning scoring beyond making it direction-aware
- introducing a new comparison dashboard for best result ranking

## Acceptance Criteria

- A user can create one research with direction and range triplets.
- The backend creates every valid concrete simulation automatically.
- Reversed direction stores negative slope bounds from absolute input values.
- Default direction stores positive slope bounds.
- Auto runner creates bots in the simulation direction instead of always `Reversed`.
- Main simulations page groups concrete runs under research.
- Existing concrete simulation detail pages still work.
