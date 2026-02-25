# Backtest Optimizer System - Detailed Implementation Plan

## Overview

Build a complete backtest optimization system integrated with the existing NestJS microservice architecture, featuring:
- GraphQL APIs for strategy component exposure
- Task queue for optimization jobs
- Automated parameter combination generation
- Result storage and navigation APIs

---

## Phase 1: Database Schema

### 1.1 Prisma Schema Additions

**File:** `prisma/schema.prisma`

```prisma
// ============================================
// BACKTEST OPTIMIZATION MODELS
// ============================================

enum BacktestTaskStatus {
  AWAIT
  PROCESSING
  DONE
  FAILED
  CANCELLED
}

model BacktestTask {
  id                String              @id @default(uuid())
  name              String              // User-friendly name
  symbol            String              // e.g., "BTCUSDT"

  // Optimization parameters (JSON)
  optimizationParams Json               // { fastEma: {min,max,step}, slowEma: {min,max,step}, ... }

  // Date range for backtest
  startDate         DateTime
  endDate           DateTime
  interval          String              @default("1m")  // candle interval

  // Progress tracking
  status            BacktestTaskStatus  @default(AWAIT)
  totalConfigs      Int                 @default(0)
  processedConfigs  Int                 @default(0)
  currentConfig     String?             // Current processing config UUID

  // Timestamps
  createdAt         DateTime            @default(now())
  startedAt         DateTime?
  completedAt       DateTime?

  // Error tracking
  errorMessage      String?

  // Relations
  results           BacktestResult[]

  @@index([status, createdAt])
  @@index([symbol])
}

model BacktestResult {
  id                String          @id @default(uuid())
  taskId            String
  task              BacktestTask    @relation(fields: [taskId], references: [id], onDelete: Cascade)

  // Result identification
  configId          String          // UUID for this specific config run
  runDate           String          // yyyy-mm-dd format

  // Strategy config used
  strategyConfig    Json            // The full composable strategy config

  // Performance metrics
  totalTrades       Int
  winningTrades     Int
  losingTrades      Int
  winRate           Float
  totalPnlUsdt      Float
  totalPnlPercent   Float
  maxDrawdownUsdt   Float
  maxDrawdownPercent Float
  sharpeRatio       Float?
  profitFactor      Float?

  // File paths (relative to result folder)
  resultFolder      String          // result/[taskId]/[date]/[configId]

  createdAt         DateTime        @default(now())

  @@index([taskId, runDate])
  @@index([taskId, totalPnlUsdt])
  @@index([taskId, winRate])
}
```

### 1.2 Migration Commands

```bash
npx prisma migrate dev --name add_backtest_optimization
npx prisma generate
```

---

## Phase 2: Backtest Engine Modifications

### 2.1 Update Export Methods

**File:** `src/backtest/composable-backtest-engine.ts`

#### Changes:

1. **New Export Structure**
```typescript
interface ExportOptions {
  taskId: string;
  configId: string;
  baseDir?: string;  // default: 'result'
}

// New method: Export all files to structured folder
async exportResults(
  result: BacktestResult,
  config: StrategyConfig,
  options: ExportOptions
): Promise<{ folder: string; files: string[] }>
```

2. **Split CSV into Two Files**
```typescript
// trade-details.csv - Individual trades
static exportTradeDetails(result: BacktestResult, filePath: string): void

// trade-summary.csv - Summary statistics
static exportTradeSummary(result: BacktestResult, filePath: string): void
```

3. **Export Config JSON**
```typescript
static exportConfig(config: StrategyConfig, filePath: string): void
```

4. **Folder Structure Creation**
```
result/
└── {taskId}/
    └── {yyyy-mm-dd}/
        └── {configId}/
            ├── config.json
            ├── trade-details.csv
            ├── trade-summary.csv
            └── pnl-chart.png
```

---

## Phase 3: GraphQL Module Structure

### 3.1 Module Files

```
src/microservices/apiService/modules/backtest/
├── backtest.module.ts
├── backtest.resolver.ts
├── backtest.service.ts
├── backtest.controller.ts
├── entities/
│   ├── backtest-task.entity.ts
│   ├── backtest-result.entity.ts
│   ├── backtest-components.entity.ts
│   ├── optimization-params.entity.ts
│   └── result-file.entity.ts
├── dto/
│   ├── create-backtest-task.input.ts
│   ├── optimization-params.input.ts
│   └── result-filter.input.ts
└── backtest-runner.service.ts      # Background job processor
```

### 3.2 GraphQL Schema Design

#### 3.2.1 Component Exposure Query

```graphql
type BacktestComponents {
  signals: [ComponentInfo!]!
  filters: [ComponentInfo!]!
  risk: [ComponentInfo!]!
  exits: [ComponentInfo!]!
}

type ComponentInfo {
  name: String!
  description: String
  params: [ParamInfo!]!
}

type ParamInfo {
  name: String!
  type: String!           # "number", "boolean", "string"
  required: Boolean!
  default: String
  description: String
  min: Float              # For numeric params
  max: Float
}

type Query {
  # Get available backtest components
  backtestComponents: BacktestComponents!
}
```

#### 3.2.2 Task Management

```graphql
enum BacktestTaskStatus {
  AWAIT
  PROCESSING
  DONE
  FAILED
  CANCELLED
}

type BacktestTask {
  id: ID!
  name: String!
  symbol: String!
  status: BacktestTaskStatus!
  optimizationParams: JSON!
  startDate: DateTime!
  endDate: DateTime!
  interval: String!
  totalConfigs: Int!
  processedConfigs: Int!
  progress: Float!          # Computed: processedConfigs / totalConfigs
  createdAt: DateTime!
  startedAt: DateTime
  completedAt: DateTime
  errorMessage: String
  results: [BacktestResult!]!
}

input CreateBacktestTaskInput {
  name: String!
  symbol: String!
  startDate: DateTime!
  endDate: DateTime!
  interval: String = "1m"
  optimizationParams: OptimizationParamsInput!
}

input OptimizationParamsInput {
  # Signal params
  fastEmaPeriod: RangeInput
  slowEmaPeriod: RangeInput

  # Filter params
  adxPeriod: RangeInput
  adxThreshold: RangeInput
  adxTimeframe: RangeInput

  # Risk params
  riskPercent: RangeInput
  stopMultiplier: RangeInput
  maxPositionPercent: RangeInput

  # Exit params
  trailingAtrMultiplier: RangeInput
  activateAfterPercent: RangeInput
  takeProfitPercent: RangeInput
}

input RangeInput {
  min: Float!
  max: Float!
  step: Float!
}

type Mutation {
  # Create new optimization task
  createBacktestTask(input: CreateBacktestTaskInput!): BacktestTask!

  # Cancel a running task
  cancelBacktestTask(taskId: ID!): BacktestTask!

  # Delete a task and its results
  deleteBacktestTask(taskId: ID!): Boolean!

  # Retry a failed task
  retryBacktestTask(taskId: ID!): BacktestTask!
}

type Query {
  # Get single task
  backtestTask(id: ID!): BacktestTask

  # List all tasks with filtering
  backtestTasks(
    status: BacktestTaskStatus
    symbol: String
    limit: Int = 20
    offset: Int = 0
  ): [BacktestTask!]!

  # Get task count by status
  backtestTaskStats: TaskStats!
}

type TaskStats {
  await: Int!
  processing: Int!
  done: Int!
  failed: Int!
}

type Subscription {
  # Subscribe to task progress updates
  backtestTaskUpdated(taskId: ID!): BacktestTask!
}
```

#### 3.2.3 Result Navigation & File Access

```graphql
type BacktestResult {
  id: ID!
  taskId: ID!
  configId: String!
  runDate: String!
  strategyConfig: JSON!

  # Metrics
  totalTrades: Int!
  winningTrades: Int!
  losingTrades: Int!
  winRate: Float!
  totalPnlUsdt: Float!
  totalPnlPercent: Float!
  maxDrawdownUsdt: Float!
  maxDrawdownPercent: Float!
  sharpeRatio: Float
  profitFactor: Float

  # File access
  resultFolder: String!
  createdAt: DateTime!
}

type ResultFolder {
  taskId: String!
  date: String!
  configId: String!
  files: [String!]!
}

type ResultFile {
  name: String!
  content: String!        # For JSON/CSV: raw content, For PNG: base64
  contentType: String!    # "application/json", "text/csv", "image/png"
  size: Int!
}

type Query {
  # Result queries
  backtestResults(
    taskId: ID!
    sortBy: String = "totalPnlUsdt"
    sortOrder: String = "desc"
    limit: Int = 50
    offset: Int = 0
  ): [BacktestResult!]!

  # Top performers
  topBacktestResults(
    taskId: ID!
    metric: String = "totalPnlUsdt"  # winRate, sharpeRatio, profitFactor
    limit: Int = 10
  ): [BacktestResult!]!

  # Folder navigation
  backtestResultDates(taskId: ID!): [String!]!
  backtestResultFolders(taskId: ID!, date: String!): [ResultFolder!]!

  # File reading
  backtestResultFile(
    taskId: ID!
    date: String!
    configId: String!
    fileName: String!      # config.json, trade-details.csv, trade-summary.csv, pnl-chart.png
  ): ResultFile!

  # Convenience methods
  backtestResultConfig(taskId: ID!, date: String!, configId: String!): JSON!
  backtestResultSummary(taskId: ID!, date: String!, configId: String!): JSON!
}
```

---

## Phase 4: Service Implementation

### 4.1 BacktestService

**File:** `src/microservices/apiService/modules/backtest/backtest.service.ts`

```typescript
@Injectable()
export class BacktestService {
  constructor(
    private prisma: PrismaService,
    @Inject(REDIS_CLIENT) private redisClient: ClientProxy,
  ) {}

  // Component exposure
  getComponents(): BacktestComponents { }

  // Task CRUD
  async createTask(input: CreateBacktestTaskInput): Promise<BacktestTask> { }
  async getTask(id: string): Promise<BacktestTask> { }
  async getTasks(filter: TaskFilter): Promise<BacktestTask[]> { }
  async cancelTask(id: string): Promise<BacktestTask> { }
  async deleteTask(id: string): Promise<boolean> { }

  // Result queries
  async getResults(taskId: string, options: ResultOptions): Promise<BacktestResult[]> { }
  async getTopResults(taskId: string, metric: string, limit: number): Promise<BacktestResult[]> { }

  // File navigation
  async getResultDates(taskId: string): Promise<string[]> { }
  async getResultFolders(taskId: string, date: string): Promise<ResultFolder[]> { }
  async getResultFile(taskId: string, date: string, configId: string, fileName: string): Promise<ResultFile> { }

  // Internal: Calculate total configurations
  calculateTotalConfigs(params: OptimizationParams): number { }

  // Internal: Generate all config combinations
  *generateConfigurations(params: OptimizationParams): Generator<StrategyConfig> { }
}
```

### 4.2 BacktestRunnerService

**File:** `src/microservices/apiService/modules/backtest/backtest-runner.service.ts`

```typescript
@Injectable()
export class BacktestRunnerService {
  private isProcessing = false;

  constructor(
    private prisma: PrismaService,
    private backtestService: BacktestService,
    @Inject(REDIS_CLIENT) private redisClient: ClientProxy,
  ) {}

  // Scheduled job - runs every 10 seconds
  @Cron('*/10 * * * * *')
  async processQueue(): Promise<void> {
    if (this.isProcessing) return;

    this.isProcessing = true;
    try {
      await this.processNextTask();
    } finally {
      this.isProcessing = false;
    }
  }

  // Process single task
  private async processNextTask(): Promise<void> {
    // 1. Get next AWAIT task
    // 2. Update status to PROCESSING
    // 3. Generate configurations
    // 4. Run backtest for each config
    // 5. Save results
    // 6. Update progress
    // 7. Mark as DONE
  }

  // Run single backtest
  private async runSingleBacktest(
    task: BacktestTask,
    config: StrategyConfig,
    configIndex: number
  ): Promise<void> { }
}
```

### 4.3 Event Patterns

**File:** `src/utils/constants.ts` (additions)

```typescript
PATTERNS = {
  // ... existing patterns

  Backtest: {
    TaskCreated: 'BACKTEST_TASK_CREATED',
    TaskUpdated: 'BACKTEST_TASK_UPDATED',
    TaskCompleted: 'BACKTEST_TASK_COMPLETED',
    TaskFailed: 'BACKTEST_TASK_FAILED',
    ResultCreated: 'BACKTEST_RESULT_CREATED',
  }
}

SUBSCRIPTION_TOKEN = {
  // ... existing tokens

  backtestTaskUpdated: 'backtestTaskUpdated',
  backtestResultCreated: 'backtestResultCreated',
}
```

---

## Phase 5: Backtest Engine Export Modifications

### 5.1 Updated Export Interface

**File:** `src/backtest/composable-backtest-engine.ts`

```typescript
export interface ExportOptions {
  taskId: string;
  configId: string;
  baseDir?: string;
}

export interface ExportResult {
  folder: string;
  files: {
    config: string;
    tradeDetails: string;
    tradeSummary: string;
    chart: string;
  };
}

export class ComposableBacktestEngine {
  // ... existing code

  /**
   * Export all results to structured folder
   */
  static async exportResults(
    result: BacktestResult,
    config: StrategyConfig,
    options: ExportOptions
  ): Promise<ExportResult> {
    const date = new Date().toISOString().split('T')[0]; // yyyy-mm-dd
    const folder = path.join(
      options.baseDir || 'result',
      options.taskId,
      date,
      options.configId
    );

    // Create folder
    fs.mkdirSync(folder, { recursive: true });

    // Export files
    const files = {
      config: path.join(folder, 'config.json'),
      tradeDetails: path.join(folder, 'trade-details.csv'),
      tradeSummary: path.join(folder, 'trade-summary.csv'),
      chart: path.join(folder, 'pnl-chart.png'),
    };

    this.exportConfig(config, files.config);
    this.exportTradeDetails(result, files.tradeDetails);
    this.exportTradeSummary(result, files.tradeSummary);
    await this.exportChart(result, files.chart, config.name);

    return { folder, files };
  }

  /**
   * Export strategy config as JSON
   */
  static exportConfig(config: StrategyConfig, filePath: string): void {
    fs.writeFileSync(filePath, JSON.stringify(config, null, 2));
  }

  /**
   * Export individual trades to CSV
   */
  static exportTradeDetails(result: BacktestResult, filePath: string): void {
    const headers = [
      'Trade #', 'Side', 'Entry Time', 'Entry Price',
      'Exit Time', 'Exit Price', 'Position Size (USDT)',
      'PnL (USDT)', 'PnL (%)', 'Cumulative PnL (USDT)'
    ];

    const rows = result.trades.map((trade, i) => [
      i + 1,
      trade.side,
      new Date(trade.entryTime).toISOString(),
      trade.entryPrice.toFixed(2),
      new Date(trade.exitTime).toISOString(),
      trade.exitPrice.toFixed(2),
      trade.positionSize.toFixed(2),
      trade.pnl.toFixed(2),
      trade.pnlPercent.toFixed(4),
      trade.cumulativePnl.toFixed(2),
    ]);

    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    fs.writeFileSync(filePath, csv);
  }

  /**
   * Export summary statistics to CSV
   */
  static exportTradeSummary(result: BacktestResult, filePath: string): void {
    const rows = [
      ['Metric', 'Value'],
      ['Symbol', result.symbol],
      ['Start Date', result.startDate.toISOString()],
      ['End Date', result.endDate.toISOString()],
      ['Total Trades', result.totalTrades],
      ['Winning Trades', result.winningTrades],
      ['Losing Trades', result.losingTrades],
      ['Win Rate (%)', result.winRate.toFixed(2)],
      ['Total PnL (USDT)', result.totalPnlUsdt.toFixed(2)],
      ['Total PnL (%)', result.totalPnlPercent.toFixed(2)],
      ['Max Drawdown (USDT)', result.maxDrawdownUsdt.toFixed(2)],
      ['Max Drawdown (%)', result.maxDrawdownPercent.toFixed(2)],
      ['Avg Position Size (USDT)', result.positionSizeUsdt.toFixed(2)],
    ];

    const csv = rows.map(r => r.join(',')).join('\n');
    fs.writeFileSync(filePath, csv);
  }
}
```

---

## Phase 6: Component Metadata

### 6.1 Component Registry Enhancement

**File:** `src/backtest/core/registry.ts` (additions)

```typescript
export interface ParamMeta {
  name: string;
  type: 'number' | 'boolean' | 'string';
  required: boolean;
  default?: any;
  description?: string;
  min?: number;
  max?: number;
}

export interface ComponentMeta {
  name: string;
  description?: string;
  params: ParamMeta[];
}

export const componentMeta: {
  signals: Record<string, ComponentMeta>;
  filters: Record<string, ComponentMeta>;
  risk: Record<string, ComponentMeta>;
  exits: Record<string, ComponentMeta>;
} = {
  signals: {
    emaCrossover: {
      name: 'EMA Crossover',
      description: 'Generates signals on EMA crossovers (golden/death cross)',
      params: [
        { name: 'fastPeriod', type: 'number', required: true, default: 20, min: 5, max: 100, description: 'Fast EMA period' },
        { name: 'slowPeriod', type: 'number', required: true, default: 50, min: 20, max: 500, description: 'Slow EMA period' },
      ]
    }
  },
  filters: {
    adxTrend: {
      name: 'ADX Trend Filter',
      description: 'Filters signals based on ADX trend strength',
      params: [
        { name: 'period', type: 'number', required: true, default: 14, min: 7, max: 50 },
        { name: 'threshold', type: 'number', required: true, default: 25, min: 10, max: 50 },
        { name: 'timeframe', type: 'number', required: false, default: 60, min: 1, max: 1440, description: 'Timeframe in minutes' },
        { name: 'inverse', type: 'boolean', required: false, default: false, description: 'Inverse filter for mean reversion' },
      ]
    }
  },
  risk: {
    fixed: {
      name: 'Fixed Position Size',
      description: 'Uses fixed USDT position size',
      params: [
        { name: 'positionSizeUsdt', type: 'number', required: true, default: 1000, min: 100 },
        { name: 'stopPercent', type: 'number', required: false, default: 2, min: 0.5, max: 10 },
      ]
    },
    atrBased: {
      name: 'ATR-Based Position Size',
      description: 'Calculates position size based on ATR volatility',
      params: [
        { name: 'riskPercent', type: 'number', required: true, default: 2, min: 0.5, max: 10 },
        { name: 'atrPeriod', type: 'number', required: false, default: 14, min: 7, max: 50 },
        { name: 'stopMultiplier', type: 'number', required: true, default: 2.5, min: 1, max: 5 },
        { name: 'capitalBase', type: 'number', required: false, default: 10000 },
        { name: 'maxPositionPercent', type: 'number', required: false, default: 20, min: 5, max: 100 },
      ]
    }
  },
  exits: {
    crossover: {
      name: 'EMA Crossover Exit',
      description: 'Exits on opposite EMA crossover',
      params: [
        { name: 'fastPeriod', type: 'number', required: false, default: 20 },
        { name: 'slowPeriod', type: 'number', required: false, default: 50 },
      ]
    },
    trailingStop: {
      name: 'Trailing Stop',
      description: 'ATR-based trailing stop with optional activation threshold',
      params: [
        { name: 'atrMultiplier', type: 'number', required: true, default: 2, min: 1, max: 5 },
        { name: 'atrPeriod', type: 'number', required: false, default: 14 },
        { name: 'activateAfterPercent', type: 'number', required: false, default: 0, min: 0, max: 10 },
      ]
    },
    takeProfit: {
      name: 'Take Profit',
      description: 'Fixed percentage or R-multiple take profit',
      params: [
        { name: 'percent', type: 'number', required: false, min: 0.5, max: 50 },
        { name: 'rMultiple', type: 'number', required: false, min: 1, max: 10 },
      ]
    }
  }
};
```

---

## Phase 7: Implementation Order

### Step-by-Step Execution

| Order | Task | Files | Dependencies |
|-------|------|-------|--------------|
| 1 | Add Prisma schema | `prisma/schema.prisma` | None |
| 2 | Run migration | - | Step 1 |
| 3 | Add component metadata | `src/backtest/core/registry.ts` | None |
| 4 | Modify backtest engine exports | `src/backtest/composable-backtest-engine.ts` | None |
| 5 | Add event patterns | `src/utils/constants.ts` | None |
| 6 | Create entity files | `modules/backtest/entities/*.ts` | Step 2 |
| 7 | Create DTO files | `modules/backtest/dto/*.ts` | Step 6 |
| 8 | Create backtest service | `modules/backtest/backtest.service.ts` | Steps 3,4,6,7 |
| 9 | Create backtest runner | `modules/backtest/backtest-runner.service.ts` | Step 8 |
| 10 | Create resolver | `modules/backtest/backtest.resolver.ts` | Steps 8,9 |
| 11 | Create controller | `modules/backtest/backtest.controller.ts` | Steps 5,8 |
| 12 | Create module | `modules/backtest/backtest.module.ts` | Steps 8-11 |
| 13 | Register module | `api.module.ts` | Step 12 |
| 14 | Test APIs | - | All |

---

## Phase 8: API Usage Examples

### 8.1 Create Optimization Task

```graphql
mutation {
  createBacktestTask(input: {
    name: "BTC EMA Optimization"
    symbol: "BTCUSDT"
    startDate: "2022-01-01"
    endDate: "2024-12-31"
    interval: "1m"
    optimizationParams: {
      fastEmaPeriod: { min: 10, max: 30, step: 5 }    # 10,15,20,25,30 = 5 values
      slowEmaPeriod: { min: 50, max: 200, step: 50 }  # 50,100,150,200 = 4 values
      adxThreshold: { min: 20, max: 30, step: 5 }     # 20,25,30 = 3 values
      # Total: 5 × 4 × 3 = 60 configurations
    }
  }) {
    id
    name
    totalConfigs
    status
  }
}
```

### 8.2 Monitor Progress

```graphql
subscription {
  backtestTaskUpdated(taskId: "abc-123") {
    id
    status
    processedConfigs
    totalConfigs
    progress
  }
}
```

### 8.3 Get Top Results

```graphql
query {
  topBacktestResults(taskId: "abc-123", metric: "totalPnlUsdt", limit: 10) {
    id
    configId
    strategyConfig
    totalPnlUsdt
    winRate
    maxDrawdownPercent
    sharpeRatio
  }
}
```

### 8.4 Read Result Files

```graphql
query {
  backtestResultFile(
    taskId: "abc-123"
    date: "2025-01-05"
    configId: "xyz-789"
    fileName: "config.json"
  ) {
    name
    content
    contentType
  }
}
```

---

## Estimated Implementation Time

| Phase | Tasks | Complexity |
|-------|-------|------------|
| Phase 1 | Database schema | Low |
| Phase 2 | Engine modifications | Medium |
| Phase 3 | GraphQL types | Medium |
| Phase 4 | Services | High |
| Phase 5 | Export modifications | Low |
| Phase 6 | Component metadata | Low |
| Phase 7-8 | Integration & testing | Medium |

---

## Questions to Clarify

1. **Authentication**: Should backtest APIs require authentication? (I assume yes based on existing patterns)

2. **Concurrency**: Should we process multiple tasks in parallel, or one at a time?

3. **Resource limits**: Max configs per task? Max concurrent tasks?

4. **Cleanup**: Auto-delete old results after X days?

5. **Additional metrics**: Do you want Sharpe ratio, profit factor, Sortino ratio calculations?
