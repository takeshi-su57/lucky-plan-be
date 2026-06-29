# Simulation Research Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a research-level grid-search workflow that generates concrete simulations from range inputs, then update the UI to browse research first and simulations second.

**Architecture:** Keep the existing concrete `Simulation -> SimulationPlan -> SimulationBot` runtime intact, and add `SimulationResearch` as a parent container that expands user-provided ranges into child simulations. Make leader evaluation direction-aware so both `Default` and `Reversed` simulations can run through the existing auto-runner with minimal churn.

**Tech Stack:** NestJS GraphQL, Prisma/PostgreSQL, Jest, Next.js, Apollo Client, HeroUI

---

### Task 1: Lock Down Grid Rules With Tests

**Files:**
- Test: `be/src/microservices/apiService/modules/simulations/simulation-research.utils.spec.ts`
- Create: `be/src/microservices/apiService/modules/simulations/simulation-research.utils.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('builds only valid simulation parameter combinations', () => {
  const combinations = buildSimulationParameterGrid({
    direction: BotMode.Default,
    minTrades: { min: 1, max: 2, gap: 1 },
    maxTrades: { min: 2, max: 3, gap: 1 },
    minR2: { min: 0.2, max: 0.3, gap: 0.1 },
    maxR2: { min: 0.3, max: 0.4, gap: 0.1 },
    minSlopeAbs: { min: 1, max: 2, gap: 1 },
    maxSlopeAbs: { min: 2, max: 3, gap: 1 },
    maxLeverage: { min: 10, max: 20, gap: 10 },
  });

  expect(combinations).toHaveLength(128);
  expect(combinations.every((item) => item.minTrades <= item.maxTrades)).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd be && npm test -- simulation-research.utils.spec.ts`
Expected: FAIL because `simulation-research.utils.ts` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```ts
export function normalizeSlopeBounds(direction: BotMode, bounds: { min: number; max: number }) {
  if (direction === BotMode.Reversed) {
    return { minSlope: -Math.abs(bounds.max), maxSlope: -Math.abs(bounds.min) };
  }

  return { minSlope: Math.abs(bounds.min), maxSlope: Math.abs(bounds.max) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd be && npm test -- simulation-research.utils.spec.ts`
Expected: PASS with 4 passing tests.

- [ ] **Step 5: Commit**

```bash
git add be/src/microservices/apiService/modules/simulations/simulation-research.utils.ts be/src/microservices/apiService/modules/simulations/simulation-research.utils.spec.ts
git commit -m "test: cover simulation research grid generation"
```

### Task 2: Add Research + Concrete Simulation Schema

**Files:**
- Modify: `be/prisma/schema.prisma`
- Create: `be/prisma/migrations/<timestamp>_simulation_research_grid/migration.sql`
- Modify: `be/src/microservices/apiService/modules/simulations/dto/simulations.input.ts`
- Modify: `be/src/microservices/apiService/modules/simulations/entities/simulations.entity.ts`

- [ ] **Step 1: Write the failing schema-facing test**

```ts
it('normalizes reversed slope bounds into negative signed values', () => {
  expect(normalizeSlopeBounds(BotMode.Reversed, { min: 1.5, max: 3.5 })).toEqual({
    minSlope: -3.5,
    maxSlope: -1.5,
  });
});
```

- [ ] **Step 2: Run the focused test to keep the contract red/green**

Run: `cd be && npm test -- simulation-research.utils.spec.ts`
Expected: PASS before schema work, then re-run after schema edits to catch accidental contract regressions.

- [ ] **Step 3: Add the Prisma and GraphQL contract**

```prisma
model SimulationResearch {
  id            Int      @id @default(autoincrement())
  title         String
  description   String
  platform      Platform
  startAt       DateTime
  endAt         DateTime
  direction     BotMode  @default(Reversed)
  minTradesMin  Int
  minTradesMax  Int
  minTradesGap  Int
  simulations   Simulation[]
}

model Simulation {
  researchId Int?
  direction  BotMode @default(Reversed)
  maxTrades  Int     @default(999999)
  minR2      Float   @default(0.25)
  maxR2      Float   @default(1)
  minSlope   Float   @default(-999999)
  maxSlope   Float   @default(0)
}
```

- [ ] **Step 4: Regenerate the backend schema**

Run: `cd be && npm run build`
Expected: `src/schema.gql` is regenerated with `SimulationResearch`, new input types, and updated `Simulation` fields.

- [ ] **Step 5: Commit**

```bash
git add be/prisma/schema.prisma be/prisma/migrations be/src/microservices/apiService/modules/simulations/dto/simulations.input.ts be/src/microservices/apiService/modules/simulations/entities/simulations.entity.ts be/src/schema.gql
git commit -m "feat: add simulation research schema and graphql contract"
```

### Task 3: Create Research and Generate Child Simulations

**Files:**
- Modify: `be/src/microservices/apiService/modules/simulations/simulations.service.ts`
- Modify: `be/src/microservices/apiService/modules/simulations/simulations.resolver.ts`
- Modify: `be/src/microservices/apiService/modules/simulations/simulations.module.ts`
- Reuse: `be/src/microservices/apiService/modules/simulations/simulation-research.utils.ts`

- [ ] **Step 1: Write the failing service test**

```ts
it('creates one simulation research and one simulation per valid parameter combination', async () => {
  const result = await service.createSimulationResearch(input);
  expect(result.totalSimulations).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd be && npm test -- simulations.service.spec.ts`
Expected: FAIL because `createSimulationResearch` does not exist yet.

- [ ] **Step 3: Implement minimal backend behavior**

```ts
const combinations = buildSimulationParameterGrid({
  direction: input.direction,
  minTrades: input.minTrades,
  maxTrades: input.maxTrades,
  minR2: input.minR2,
  maxR2: input.maxR2,
  minSlopeAbs: input.minSlope,
  maxSlopeAbs: input.maxSlope,
  maxLeverage: input.maxLeverage,
});
```

- [ ] **Step 4: Add research queries**

```ts
@Query(() => SimulationResearchConnection)
simulationResearches(...) {
  return this.simulationsService.getSimulationResearches(first, after);
}
```

- [ ] **Step 5: Run verification**

Run: `cd be && npm test -- simulation-research.utils.spec.ts simulations.service.spec.ts`
Expected: PASS for both the utility and service-level creation flow.

- [ ] **Step 6: Commit**

```bash
git add be/src/microservices/apiService/modules/simulations/simulations.service.ts be/src/microservices/apiService/modules/simulations/simulations.resolver.ts be/src/microservices/apiService/modules/simulations/simulations.module.ts
git commit -m "feat: create simulation research and child simulations"
```

### Task 4: Make Evaluation and Bot Creation Direction-Aware

**Files:**
- Modify: `be/src/microservices/apiService/modules/simulations/simulation-leader-evaluator.service.ts`
- Modify: `be/src/microservices/apiService/modules/simulations/simulation-automation.utils.ts`
- Modify: `be/src/microservices/apiService/modules/simulations/simulation-auto-runner.service.ts`

- [ ] **Step 1: Write the failing evaluator test**

```ts
it('creates default-mode bots for default-direction simulations', async () => {
  await service.createSimulationBotsForSelections(...);
  expect(prisma.simulationBot.createMany).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.arrayContaining([
        expect.objectContaining({ mode: BotMode.Default }),
      ]),
    }),
  );
});
```

- [ ] **Step 2: Run the targeted test**

Run: `cd be && npm test -- simulation-cache.service.spec.ts`
Expected: FAIL or require new coverage proving direction is still hardcoded to `Reversed`.

- [ ] **Step 3: Implement the minimal direction-aware flow**

```ts
mode: simulation.direction,
```

```ts
if (rawTradeCount < simulation.minTrades || rawTradeCount > simulation.maxTrades) {
  return { ...baseEvaluation, rejectedReason: 'TRADE_COUNT_OUT_OF_RANGE' };
}
```

- [ ] **Step 4: Run verification**

Run: `cd be && npm test -- simulation-research.utils.spec.ts simulation-cache.service.spec.ts`
Expected: PASS with direction-aware bot creation and bounded candidate filtering.

- [ ] **Step 5: Commit**

```bash
git add be/src/microservices/apiService/modules/simulations/simulation-leader-evaluator.service.ts be/src/microservices/apiService/modules/simulations/simulation-automation.utils.ts be/src/microservices/apiService/modules/simulations/simulation-auto-runner.service.ts
git commit -m "feat: support default and reversed simulation directions"
```

### Task 5: Upgrade Frontend to Research-First Navigation

**Files:**
- Modify: `fe/app/_hooks/useSimulations.tsx`
- Modify: `fe/app/_components/SimulationsWidget/SimulationCreationPanel.tsx`
- Modify: `fe/app/_components/SimulationsWidget/Simulations.tsx`
- Create: `fe/app/_components/SimulationsWidget/SimulationResearchRow.tsx`
- Create: `fe/app/_components/SimulationsWidget/SimulationResearchDetailPanel.tsx`
- Create: `fe/app/simulations/research/[researchId]/page.tsx`

- [ ] **Step 1: Write the failing frontend contract change**

```tsx
const { createSimulationResearch } = useCreateSimulationResearch();
await createSimulationResearch({ variables: { input } });
```

- [ ] **Step 2: Run frontend lint/type verification**

Run: `cd fe && npm run lint`
Expected: FAIL until the new hooks, fragments, and components exist.

- [ ] **Step 3: Implement the research form**

```tsx
<NumericRangeGroup
  label="Min Trades"
  value={minTrades}
  onChange={setMinTrades}
/>
```

- [ ] **Step 4: Implement research list/detail queries and pages**

```ts
query simulationResearches($after: Int, $first: Int!) {
  simulationResearches(after: $after, first: $first) {
    edges { node { id title direction totalSimulations completedSimulations } }
  }
}
```

- [ ] **Step 5: Regenerate frontend GraphQL types**

Run: `cd fe && npm run generate`
Expected: generated GraphQL artifacts update without type errors.

- [ ] **Step 6: Run frontend verification**

Run: `cd fe && npm run lint`
Expected: PASS with the research creation flow and grouped navigation.

- [ ] **Step 7: Commit**

```bash
git add fe/app/_hooks/useSimulations.tsx fe/app/_components/SimulationsWidget/SimulationCreationPanel.tsx fe/app/_components/SimulationsWidget/Simulations.tsx fe/app/_components/SimulationsWidget/SimulationResearchRow.tsx fe/app/_components/SimulationsWidget/SimulationResearchDetailPanel.tsx fe/app/simulations/research
git commit -m "feat: add research-first simulation frontend"
```

### Task 6: Final Verification and Docs Sync

**Files:**
- Modify: `be/docs/simulation-progress-frontend-memory.md` (only if behavior notes must be updated)
- Modify: `fe/docs/simulation-progress-frontend-memory.md` (only if UI navigation notes must be updated)

- [ ] **Step 1: Run backend verification**

Run: `cd be && npm test -- simulation-research.utils.spec.ts`
Expected: PASS

- [ ] **Step 2: Run backend build**

Run: `cd be && npm run build`
Expected: PASS and regenerate `be/src/schema.gql`

- [ ] **Step 3: Run frontend verification**

Run: `cd fe && npm run generate && npm run lint`
Expected: PASS

- [ ] **Step 4: Re-check spec coverage**

```text
Research layer added
Grid combinations generated
Direction-aware slopes normalized
Simulation bots use selected direction
Frontend grouped by research
```

- [ ] **Step 5: Commit**

```bash
git add be/docs fe/docs
git commit -m "docs: record simulation research workflow"
```
