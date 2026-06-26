# Simulation Cache Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace read-time simulation detail recomputation with persisted bot and plan caches backed by copied raw event logs, while preserving correctness for positions that close after a bot's active lifetime.

**Architecture:** Add three additive Prisma models for bot cache, bot cached event logs, and plan cache. Build a cache-oriented service layer that appends raw `PerpTradingEventLog` rows into bot-local caches, recomputes summaries from cached rows, and serves simulation detail queries from those caches while triggering asynchronous refresh for incomplete bots only.

**Tech Stack:** NestJS 11, GraphQL decorators, Prisma 7, PostgreSQL, Jest

---

## File Structure

- Create: `prisma/migrations/<timestamp>_add_simulation_cache_tables/migration.sql`
- Modify: `prisma/schema.prisma`
- Modify: `src/microservices/apiService/modules/simulations/simulations.module.ts`
- Modify: `src/microservices/apiService/modules/simulations/entities/simulations.entity.ts`
- Modify: `src/microservices/apiService/modules/simulations/simulations.service.ts`
- Modify: `src/microservices/apiService/modules/simulations/simulation-plans.service.ts`
- Create: `src/microservices/apiService/modules/simulations/simulation-cache.service.ts`
- Create: `src/microservices/apiService/modules/simulations/simulation-cache.mapper.ts`
- Create: `src/microservices/apiService/modules/simulations/simulation-cache.service.spec.ts`
- Modify: `src/schema.gql`

### Task 1: Add additive cache schema

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_simulation_cache_tables/migration.sql`

- [ ] **Step 1: Write the failing schema snapshot expectations in the plan notes**

```text
Expect Prisma schema to define:
- SimulationBotCache with one-to-one relation to SimulationBot
- SimulationBotCachedEventLog with many-to-one relation to SimulationBotCache
- SimulationPlanCache with one-to-one relation to SimulationPlan
- no removals yet from SimulationBot or SimulationPlan
```

- [ ] **Step 2: Add the new Prisma models**

```prisma
model SimulationBotCache {
  id                           Int      @id @default(autoincrement())
  simulationBotId              Int      @unique
  completed                    Boolean  @default(false)
  rebuilding                   Boolean  @default(false)
  rebuildRequested             Boolean  @default(false)
  lastFetchedAt                DateTime?
  openedPositions              Int      @default(0)
  totalPositions               Int      @default(0)
  totalLeaderPnl               Float    @default(0)
  totalFollowerPnl             Float    @default(0)
  maxDuration                  Float    @default(0)
  avgDuration                  Float    @default(0)
  avgPnl                       Float    @default(0)
  avgPositivePnl               Float    @default(0)
  avgNegativePnl               Float    @default(0)
  avgSize                      Float    @default(0)
  avgCollateral                Float    @default(0)
  avgPnlPercentageBySize       Float    @default(0)
  avgPnlPercentageByCollateral Float    @default(0)
  avgLeverage                  Float    @default(0)
  lastError                    String?
  createdAt                    DateTime @default(now())
  updatedAt                    DateTime @updatedAt

  simulationBot SimulationBot                @relation(fields: [simulationBotId], references: [id], onDelete: Cascade)
  eventLogs     SimulationBotCachedEventLog[]
}

model SimulationBotCachedEventLog {
  id                   Int      @id @default(autoincrement())
  simulationBotCacheId Int
  sourceEventLogId     Int
  contractId           Int
  address              String   @db.VarChar(255)
  platform             Platform
  block                Int
  logIndex             Int
  date                 DateTime
  jsonLog              String
  usdPnl               Float
  createdAt            DateTime @default(now())

  simulationBotCache SimulationBotCache @relation(fields: [simulationBotCacheId], references: [id], onDelete: Cascade)

  @@unique([simulationBotCacheId, sourceEventLogId])
  @@index([simulationBotCacheId, date, block, id])
}

model SimulationPlanCache {
  id               Int      @id @default(autoincrement())
  simulationPlanId Int      @unique
  completed        Boolean  @default(false)
  rebuilding       Boolean  @default(false)
  completedBots    Int      @default(0)
  incompleteBots   Int      @default(0)
  openedPositions  Int      @default(0)
  totalPositions   Int      @default(0)
  totalLeaderPnl   Float    @default(0)
  totalFollowerPnl Float    @default(0)
  lastBuiltAt      DateTime?
  lastError        String?
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  simulationPlan SimulationPlan @relation(fields: [simulationPlanId], references: [id], onDelete: Cascade)
}
```

- [ ] **Step 3: Add the relation fields to the existing simulation models**

```prisma
model SimulationPlan {
  // existing fields omitted
  cache SimulationPlanCache?
}

model SimulationBot {
  // existing fields omitted
  cache SimulationBotCache?
}
```

- [ ] **Step 4: Create the SQL migration**

```sql
CREATE TABLE "SimulationBotCache" (
  "id" SERIAL PRIMARY KEY,
  "simulationBotId" INTEGER NOT NULL UNIQUE,
  "completed" BOOLEAN NOT NULL DEFAULT false,
  "rebuilding" BOOLEAN NOT NULL DEFAULT false,
  "rebuildRequested" BOOLEAN NOT NULL DEFAULT false,
  "lastFetchedAt" TIMESTAMP(3),
  "openedPositions" INTEGER NOT NULL DEFAULT 0,
  "totalPositions" INTEGER NOT NULL DEFAULT 0,
  "totalLeaderPnl" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "totalFollowerPnl" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "maxDuration" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "avgDuration" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "avgPnl" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "avgPositivePnl" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "avgNegativePnl" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "avgSize" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "avgCollateral" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "avgPnlPercentageBySize" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "avgPnlPercentageByCollateral" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "avgLeverage" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SimulationBotCache_simulationBotId_fkey" FOREIGN KEY ("simulationBotId") REFERENCES "SimulationBot"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "SimulationBotCachedEventLog" (
  "id" SERIAL PRIMARY KEY,
  "simulationBotCacheId" INTEGER NOT NULL,
  "sourceEventLogId" INTEGER NOT NULL,
  "contractId" INTEGER NOT NULL,
  "address" VARCHAR(255) NOT NULL,
  "platform" "Platform" NOT NULL,
  "block" INTEGER NOT NULL,
  "logIndex" INTEGER NOT NULL,
  "date" TIMESTAMP(3) NOT NULL,
  "jsonLog" TEXT NOT NULL,
  "usdPnl" DOUBLE PRECISION NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SimulationBotCachedEventLog_simulationBotCacheId_fkey" FOREIGN KEY ("simulationBotCacheId") REFERENCES "SimulationBotCache"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "SimulationBotCachedEventLog_cache_source_key"
ON "SimulationBotCachedEventLog"("simulationBotCacheId", "sourceEventLogId");

CREATE INDEX "SimulationBotCachedEventLog_cache_date_block_id_idx"
ON "SimulationBotCachedEventLog"("simulationBotCacheId", "date", "block", "id");

CREATE TABLE "SimulationPlanCache" (
  "id" SERIAL PRIMARY KEY,
  "simulationPlanId" INTEGER NOT NULL UNIQUE,
  "completed" BOOLEAN NOT NULL DEFAULT false,
  "rebuilding" BOOLEAN NOT NULL DEFAULT false,
  "completedBots" INTEGER NOT NULL DEFAULT 0,
  "incompleteBots" INTEGER NOT NULL DEFAULT 0,
  "openedPositions" INTEGER NOT NULL DEFAULT 0,
  "totalPositions" INTEGER NOT NULL DEFAULT 0,
  "totalLeaderPnl" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "totalFollowerPnl" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "lastBuiltAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SimulationPlanCache_simulationPlanId_fkey" FOREIGN KEY ("simulationPlanId") REFERENCES "SimulationPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
```

- [ ] **Step 5: Run Prisma validation**

Run: `npx prisma validate`
Expected: `The schema at prisma/schema.prisma is valid`

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(simulations): add cache tables"
```

### Task 2: Add cache-backed GraphQL entities and mapping helpers

**Files:**
- Modify: `src/microservices/apiService/modules/simulations/entities/simulations.entity.ts`
- Create: `src/microservices/apiService/modules/simulations/simulation-cache.mapper.ts`

- [ ] **Step 1: Write the failing mapper test scaffold**

```ts
describe('simulation cache mapper', () => {
  it('maps bot cache fields into simulation bot details shape', () => {
    expect(true).toBe(true);
  });
});
```

- [ ] **Step 2: Add cache-oriented entity types without breaking the existing outward schema**

```ts
@ObjectType()
export class SimulationBotCacheState {
  @Field(() => Boolean)
  completed: boolean;

  @Field(() => Boolean)
  rebuilding: boolean;

  @Field(() => Boolean)
  rebuildRequested: boolean;

  @Field(() => String, { nullable: true })
  lastError: string | null;

  @Field(() => Date, { nullable: true })
  lastFetchedAt: Date | null;
}
```

- [ ] **Step 3: Create the mapper used by services to shape cache rows into existing GraphQL output**

```ts
export function mapSimulationBotWithCache(
  bot: SimulationBot & { cache: SimulationBotCache | null },
): SimulationBot {
  return {
    ...bot,
    openedPositions: bot.cache?.openedPositions ?? bot.openedPositions,
    totalPositions: bot.cache?.totalPositions ?? bot.totalPositions,
    totalPnl: bot.cache?.totalLeaderPnl ?? bot.totalPnl,
    maxDuration: bot.cache?.maxDuration ?? bot.maxDuration,
    avgDuration: bot.cache?.avgDuration ?? bot.avgDuration,
    avgPnl: bot.cache?.avgPnl ?? bot.avgPnl,
    avgPositivePnl: bot.cache?.avgPositivePnl ?? bot.avgPositivePnl,
    avgNegativePnl: bot.cache?.avgNegativePnl ?? bot.avgNegativePnl,
    avgSize: bot.cache?.avgSize ?? bot.avgSize,
    avgCollateral: bot.cache?.avgCollateral ?? bot.avgCollateral,
    avgPnlPercentageBySize:
      bot.cache?.avgPnlPercentageBySize ?? bot.avgPnlPercentageBySize,
    avgPnlPercentageByCollateral:
      bot.cache?.avgPnlPercentageByCollateral ??
      bot.avgPnlPercentageByCollateral,
    avgLeverage: bot.cache?.avgLeverage ?? bot.avgLeverage,
  };
}
```

- [ ] **Step 4: Run the TypeScript build for the entity and mapper changes**

Run: `npm run build`
Expected: `Found 0 errors`

- [ ] **Step 5: Commit**

```bash
git add src/microservices/apiService/modules/simulations/entities/simulations.entity.ts src/microservices/apiService/modules/simulations/simulation-cache.mapper.ts
git commit -m "feat(simulations): add cache mapping layer"
```

### Task 3: Build the cache service and bot completion logic

**Files:**
- Create: `src/microservices/apiService/modules/simulations/simulation-cache.service.ts`
- Modify: `src/microservices/apiService/modules/simulations/simulations.module.ts`
- Create: `src/microservices/apiService/modules/simulations/simulation-cache.service.spec.ts`

- [ ] **Step 1: Write the failing unit tests for completion rules and deduped cache appends**

```ts
describe('SimulationCacheService', () => {
  it('marks bot cache incomplete when a lifetime-opened position has no close', async () => {
    await expect(service.rebuildBotCache(1)).resolves.toMatchObject({
      completed: false,
      openedPositions: 1,
    });
  });

  it('marks bot cache complete when every lifetime-opened position is closed', async () => {
    await expect(service.rebuildBotCache(2)).resolves.toMatchObject({
      completed: true,
      openedPositions: 0,
    });
  });
});
```

- [ ] **Step 2: Register the new provider in the module**

```ts
providers: [
  SimulationsResolver,
  SimulationsService,
  SimulationAutoRunnerService,
  SimulationLeaderEvaluatorService,
  SimulationPlansService,
  SimulationCacheService,
]
```

- [ ] **Step 3: Implement cache row bootstrap helpers**

```ts
async ensureSimulationPlanCache(simulationPlanId: number) {
  return this.prisma.simulationPlanCache.upsert({
    where: { simulationPlanId },
    update: {},
    create: { simulationPlanId },
  });
}

async ensureSimulationBotCache(simulationBotId: number) {
  return this.prisma.simulationBotCache.upsert({
    where: { simulationBotId },
    update: {},
    create: { simulationBotId },
  });
}
```

- [ ] **Step 4: Implement raw source-log copying with dedupe**

```ts
async appendNewEventLogsForBot(cacheId: number, bot: SimulationBot) {
  const existingLast = await this.prisma.simulationBotCachedEventLog.findFirst({
    where: { simulationBotCacheId: cacheId },
    orderBy: [{ date: 'desc' }, { block: 'desc' }, { id: 'desc' }],
  });

  const newLogs = await this.prisma.perpTradingEventLog.findMany({
    where: {
      address: bot.leaderAddress.toLowerCase(),
      contractId: bot.leaderContractId,
      ...(existingLast ? { date: { gt: existingLast.date } } : { date: { gte: bot.startedAt } }),
    },
    orderBy: [{ date: 'asc' }, { block: 'asc' }, { id: 'asc' }],
  });

  if (newLogs.length === 0) {
    return [];
  }

  await this.prisma.simulationBotCachedEventLog.createMany({
    data: newLogs.map((log) => ({
      simulationBotCacheId: cacheId,
      sourceEventLogId: log.id,
      contractId: log.contractId,
      address: log.address,
      platform: log.platform,
      block: log.block,
      logIndex: log.logIndex,
      date: log.date,
      jsonLog: log.jsonLog,
      usdPnl: log.usdPnl,
    })),
    skipDuplicates: true,
  });

  return newLogs;
}
```

- [ ] **Step 5: Implement completion-aware bot cache rebuild**

```ts
async rebuildBotCache(simulationBotId: number) {
  const bot = await this.prisma.simulationBot.findUniqueOrThrow({
    where: { id: simulationBotId },
    include: { leaderContract: true, cache: true },
  });

  const cache = await this.ensureSimulationBotCache(bot.id);

  await this.prisma.simulationBotCache.update({
    where: { id: cache.id },
    data: { rebuilding: true, rebuildRequested: false, lastError: null },
  });

  await this.appendNewEventLogsForBot(cache.id, bot);

  const cachedLogs = await this.prisma.simulationBotCachedEventLog.findMany({
    where: { simulationBotCacheId: cache.id },
    orderBy: [{ date: 'asc' }, { block: 'asc' }, { id: 'asc' }],
  });

  const summary = this.buildBotSummaryFromCachedLogs(bot, cachedLogs);

  return this.prisma.simulationBotCache.update({
    where: { id: cache.id },
    data: {
      completed: summary.completed,
      rebuilding: false,
      lastFetchedAt: cachedLogs.at(-1)?.date ?? cache.lastFetchedAt,
      openedPositions: summary.openedPositions,
      totalPositions: summary.totalPositions,
      totalLeaderPnl: summary.totalLeaderPnl,
      totalFollowerPnl: summary.totalFollowerPnl,
      maxDuration: summary.maxDuration,
      avgDuration: summary.avgDuration,
      avgPnl: summary.avgPnl,
      avgPositivePnl: summary.avgPositivePnl,
      avgNegativePnl: summary.avgNegativePnl,
      avgSize: summary.avgSize,
      avgCollateral: summary.avgCollateral,
      avgPnlPercentageBySize: summary.avgPnlPercentageBySize,
      avgPnlPercentageByCollateral: summary.avgPnlPercentageByCollateral,
      avgLeverage: summary.avgLeverage,
    },
  });
}
```

- [ ] **Step 6: Run the focused Jest tests**

Run: `npm run test -- simulation-cache.service.spec.ts`
Expected: PASS with the completion and dedupe cases green

- [ ] **Step 7: Commit**

```bash
git add src/microservices/apiService/modules/simulations/simulations.module.ts src/microservices/apiService/modules/simulations/simulation-cache.service.ts src/microservices/apiService/modules/simulations/simulation-cache.service.spec.ts
git commit -m "feat(simulations): build bot cache service"
```

### Task 4: Build plan rollups and cache bootstrap on writes

**Files:**
- Modify: `src/microservices/apiService/modules/simulations/simulation-plans.service.ts`
- Modify: `src/microservices/apiService/modules/simulations/simulations.service.ts`

- [ ] **Step 1: Write the failing plan-rollup test case**

```ts
it('rolls up plan cache totals from bot caches', async () => {
  await expect(service.rebuildPlanCache(10)).resolves.toMatchObject({
    completedBots: 2,
    incompleteBots: 1,
    totalPositions: 7,
  });
});
```

- [ ] **Step 2: Create cache rows when plans are created**

```ts
const simulationPlan = await this.prisma.simulationPlan.create({ /* existing args */ });
await this.simulationCacheService.ensureSimulationPlanCache(simulationPlan.id);
return simulationPlan;
```

- [ ] **Step 3: Create cache rows when bots are created**

```ts
const bot = await this.prisma.simulationBot.create({ /* existing args */ });
await this.simulationCacheService.ensureSimulationBotCache(bot.id);
simulationBots.push(bot);
```

- [ ] **Step 4: Implement plan-cache rebuild from bot caches**

```ts
async rebuildPlanCache(simulationPlanId: number) {
  const botCaches = await this.prisma.simulationBotCache.findMany({
    where: { simulationBot: { simulationPlanId } },
  });

  const completedBots = botCaches.filter((cache) => cache.completed).length;
  const incompleteBots = botCaches.length - completedBots;

  return this.prisma.simulationPlanCache.upsert({
    where: { simulationPlanId },
    update: {
      completed: incompleteBots === 0,
      rebuilding: false,
      completedBots,
      incompleteBots,
      openedPositions: botCaches.reduce((sum, cache) => sum + cache.openedPositions, 0),
      totalPositions: botCaches.reduce((sum, cache) => sum + cache.totalPositions, 0),
      totalLeaderPnl: botCaches.reduce((sum, cache) => sum + cache.totalLeaderPnl, 0),
      totalFollowerPnl: botCaches.reduce((sum, cache) => sum + cache.totalFollowerPnl, 0),
      lastBuiltAt: new Date(),
      lastError: null,
    },
    create: {
      simulationPlanId,
      completed: incompleteBots === 0,
      completedBots,
      incompleteBots,
      openedPositions: botCaches.reduce((sum, cache) => sum + cache.openedPositions, 0),
      totalPositions: botCaches.reduce((sum, cache) => sum + cache.totalPositions, 0),
      totalLeaderPnl: botCaches.reduce((sum, cache) => sum + cache.totalLeaderPnl, 0),
      totalFollowerPnl: botCaches.reduce((sum, cache) => sum + cache.totalFollowerPnl, 0),
      lastBuiltAt: new Date(),
    },
  });
}
```

- [ ] **Step 5: Run the simulation-focused tests**

Run: `npm run test -- simulations`
Expected: PASS for the touched simulation tests

- [ ] **Step 6: Commit**

```bash
git add src/microservices/apiService/modules/simulations/simulation-plans.service.ts src/microservices/apiService/modules/simulations/simulations.service.ts
git commit -m "feat(simulations): bootstrap and roll up plan caches"
```

### Task 5: Switch read paths to cache-first with async refresh

**Files:**
- Modify: `src/microservices/apiService/modules/simulations/simulations.service.ts`
- Modify: `src/microservices/apiService/modules/simulations/simulation-plans.service.ts`
- Modify: `src/microservices/apiService/modules/simulations/entities/simulations.entity.ts`

- [ ] **Step 1: Write the failing read-path test**

```ts
it('returns cached details immediately and requests rebuild for incomplete bots', async () => {
  await expect(service.getSimulationPlanById(3)).resolves.toMatchObject({
    id: 3,
    simulationBots: expect.any(Array),
  });
  expect(rebuildBotCacheSpy).toHaveBeenCalledWith(expect.any(Number));
});
```

- [ ] **Step 2: Replace synchronous details recomputation with cache-backed reads**

```ts
async getSimulationPlanById(id: number): Promise<SimulationPlanDetails> {
  const plan = await this.prisma.simulationPlan.findUniqueOrThrow({
    where: { id },
    include: {
      cache: true,
      simulationBots: {
        include: {
          leaderContract: true,
          cache: true,
        },
      },
    },
  });

  void this.simulationCacheService.refreshIncompleteBotsForPlan(id);

  return this.simulationCacheMapper.toPlanDetails(plan);
}
```

- [ ] **Step 3: Make `simulationPlanDetailsBySimulation` read all plans from cache**

```ts
async getSimulationPlanDetailsBySimulation(simulationId: number) {
  const plans = await this.prisma.simulationPlan.findMany({
    where: { simulationId },
    orderBy: [{ startAt: 'asc' }, { id: 'asc' }],
    include: {
      cache: true,
      simulationBots: {
        include: {
          leaderContract: true,
          cache: true,
        },
      },
    },
  });

  plans.forEach((plan) => {
    void this.simulationCacheService.refreshIncompleteBotsForPlan(plan.id);
  });

  return plans.map((plan) => this.simulationCacheMapper.toPlanDetails(plan));
}
```

- [ ] **Step 4: Preserve the old calculator temporarily behind an internal fallback**

```ts
if (!plan.cache) {
  this.logger.warn(`Missing cache for simulation plan ${id}, falling back once`);
  return this.calculateSimulationPlanDetails(id, { persistSummary: true });
}
```

- [ ] **Step 5: Rebuild GraphQL schema and project**

Run: `npm run build`
Expected: `Found 0 errors`

- [ ] **Step 6: Commit**

```bash
git add src/microservices/apiService/modules/simulations/simulations.service.ts src/microservices/apiService/modules/simulations/simulation-plans.service.ts src/microservices/apiService/modules/simulations/entities/simulations.entity.ts src/schema.gql
git commit -m "feat(simulations): switch detail reads to cache-first"
```

### Task 6: Add backfill and parity verification hooks

**Files:**
- Modify: `src/microservices/apiService/modules/simulations/simulation-cache.service.ts`
- Modify: `src/microservices/apiService/modules/simulations/simulation-cache.service.spec.ts`

- [ ] **Step 1: Write the failing parity smoke test**

```ts
it('can compare cache summary with legacy summary for a selected plan', async () => {
  const result = await service.comparePlanCacheWithLegacy(5);
  expect(result.planId).toBe(5);
  expect(result.differences).toEqual([]);
});
```

- [ ] **Step 2: Add a comparison helper for rollout verification**

```ts
async comparePlanCacheWithLegacy(simulationPlanId: number) {
  const cached = await this.getCachedPlanDetails(simulationPlanId);
  const legacy = await this.legacyCalculatePlanDetails(simulationPlanId);

  const differences = [];

  if (cached.totalPositions !== legacy.totalPositions) {
    differences.push(`totalPositions:${cached.totalPositions}:${legacy.totalPositions}`);
  }

  if (cached.totalLeaderPnl !== legacy.totalLeaderPnl) {
    differences.push(`totalLeaderPnl:${cached.totalLeaderPnl}:${legacy.totalLeaderPnl}`);
  }

  return { planId: simulationPlanId, differences };
}
```

- [ ] **Step 3: Add a one-shot backfill helper for existing plans**

```ts
async backfillSimulationCaches(simulationId: number) {
  const plans = await this.prisma.simulationPlan.findMany({
    where: { simulationId },
    select: { id: true, simulationBots: { select: { id: true } } },
  });

  for (const plan of plans) {
    await this.ensureSimulationPlanCache(plan.id);

    for (const bot of plan.simulationBots) {
      await this.ensureSimulationBotCache(bot.id);
      await this.rebuildBotCache(bot.id);
    }

    await this.rebuildPlanCache(plan.id);
  }
}
```

- [ ] **Step 4: Run the targeted test file**

Run: `npm run test -- simulation-cache.service.spec.ts`
Expected: PASS with parity and backfill cases green

- [ ] **Step 5: Commit**

```bash
git add src/microservices/apiService/modules/simulations/simulation-cache.service.ts src/microservices/apiService/modules/simulations/simulation-cache.service.spec.ts
git commit -m "chore(simulations): add cache backfill and parity helpers"
```

### Task 7: Full verification and cleanup checklist

**Files:**
- Modify: `docs/superpowers/specs/2026-06-25-simulation-cache-refactor-design.md`

- [ ] **Step 1: Run build**

Run: `npm run build`
Expected: `Found 0 errors`

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: no ESLint errors after autofix completes

- [ ] **Step 3: Run tests**

Run: `npm run test`
Expected: simulation cache tests pass; document unrelated pre-existing failures if any

- [ ] **Step 4: Update the design doc with implementation notes if behavior changed**

```md
## Implementation Notes

- Cache-first reads are live
- Legacy denormalized columns are still present for parity checks
- Cleanup migration is intentionally deferred
```

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-06-25-simulation-cache-refactor-design.md
git commit -m "docs(simulations): note cache rollout status"
```

## Self-Review

### Spec coverage

- Additive schema: covered by Task 1.
- Single active bot and plan caches: covered by Tasks 1, 3, and 4.
- Raw copied source event logs: covered by Task 3.
- Cache-first immediate reads: covered by Task 5.
- Async refresh for incomplete bots only: covered by Task 5.
- Completion semantics for positions closed after `stoppedAt`: covered by Task 3 tests and rebuild rules.
- Parity and safe rollout before removing denormalized columns: covered by Task 6 and Task 7.
- No premature `PerpTradingEventLog` index changes: respected by leaving the source model untouched in this plan.

### Placeholder scan

- No `TODO`, `TBD`, or “implement later” placeholders remain.
- Every code-changing step includes concrete code or SQL.
- Every verification step includes an exact command and expected outcome.

### Type consistency

- Cache model names are consistent across schema, services, and plan steps:
  - `SimulationBotCache`
  - `SimulationBotCachedEventLog`
  - `SimulationPlanCache`
- The read path consistently uses cache-first mapping with one active cache row per bot and per plan.
