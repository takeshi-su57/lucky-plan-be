# Optuna Integration Plan

## Overview

Integrate the Optuna-based parameter optimizer (`src/backtest/optimizer`) with the existing NestJS backtest module (`src/microservices/apiService/modules/backtest`). This enables:

1. **Unified Result Recording**: Both grid search and Optuna optimization record results to the same DB/filesystem
2. **Dual Visualization**: Access both Optuna dashboard AND custom backtest result review system
3. **API-Driven Optimization**: Create and manage Optuna optimization tasks via GraphQL

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           GraphQL API                                       │
│  - createBacktestTask (searchStrategy: 'grid' | 'optuna')                   │
│  - backtestResults, topBacktestResults                                      │
│  - startOptunaDashboard, stopOptunaDashboard                                │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     BacktestRunnerService (Cron)                            │
│                                                                             │
│  if searchStrategy == 'grid':                                               │
│    → Existing grid search logic                                             │
│                                                                             │
│  if searchStrategy == 'optuna':                                             │
│    → Spawn optimizer.py (fire & forget)                                     │
│    → Python script manages its own lifecycle                                │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    ▼                               ▼
        ┌───────────────────┐           ┌───────────────────────────┐
        │   Grid Search     │           │      optimizer.py         │
        │   (TypeScript)    │           │      (Python/Optuna)      │
        │                   │           │                           │
        │  for each config: │           │  for each trial:          │
        │    runBacktest()  │           │    POST /run-single       │
        │    saveResult()   │           │    receive score          │
        └───────────────────┘           │                           │
                                        │  on success:              │
                                        │    POST /task/:id/complete│
                                        │                           │
                                        │  on error:                │
                                        │    POST /task/:id/fail    │
                                        └───────────────────────────┘
                                                    │
                                                    ▼
                                        ┌───────────────────────────┐
                                        │  POST /backtest/run-single│
                                        │                           │
                                        │  1. Run backtest          │
                                        │  2. Save to DB/filesystem │
                                        │  3. Update progress       │
                                        │  4. Calculate score       │
                                        │  5. Return { score }      │
                                        └───────────────────────────┘
```

---

## Phase 1: Schema Changes

### 1.1 Prisma Schema Updates

**File:** `prisma/schema.prisma`

Add new fields to `BacktestTask`:

```prisma
model BacktestTask {
  // ... existing fields ...

  // NEW: Optimization method discriminator
  searchStrategy      String    @default("grid")  // 'grid' | 'optuna'

  // NEW: Optuna-specific settings
  optimizationMetric  String?                     // 'sharpeRatio', 'calmar', 'totalPnlPercent', etc.
  trials              Int?                        // Number of Optuna trials
  direction           String    @default("maximize") // 'maximize' | 'minimize'

  // NEW: Optuna results
  bestParams          Json?                       // Best parameters found
  optunaStudyPath     String?                     // Path to per-task SQLite DB
}
```

### 1.2 Migration

```bash
npx prisma migrate dev --name add_optuna_fields
npx prisma generate
```

---

## Phase 2: New HTTP Endpoints

### 2.1 Endpoint Summary

| Method | Path | Purpose | Auth |
|--------|------|---------|------|
| POST | `/backtest/run-single` | Run single backtest, return score | No (localhost only) |
| POST | `/backtest/task/:id/complete` | Mark task complete with bestParams | No (localhost only) |
| POST | `/backtest/task/:id/fail` | Mark task failed with error | No (localhost only) |
| POST | `/backtest/optuna-dashboard` | Start Optuna dashboard for taskId | Yes (GraphQL) |
| DELETE | `/backtest/optuna-dashboard` | Stop running dashboard | Yes (GraphQL) |

### 2.2 Run Single Endpoint

**Purpose:** Execute a single backtest trial and return the score for Optuna to optimize.

```typescript
// POST /backtest/run-single
// Request
interface RunSingleRequest {
  taskId: string;
  configId: string;        // UUID generated by optimizer.py
  strategyConfig: object;  // Concrete StrategyConfig for this trial
}

// Response
interface RunSingleResponse {
  success: boolean;
  score: number;           // Calculated based on task's optimizationMetric
  metrics: {
    sharpeRatio: number | null;
    totalPnlPercent: number;
    totalPnlUsdt: number;
    winRate: number;
    totalTrades: number;
    maxDrawdownPercent: number;
    maxDrawdownUsdt: number;
    profitFactor: number | null;
  };
  error?: string;
}
```

**Implementation Logic:**

1. Fetch task to get `optimizationMetric`
2. Run backtest using `ComposableBacktestEngine`
3. Save result to DB using existing `saveResult()` method
4. Export result files to filesystem
5. Increment `processedConfigs` on task
6. Calculate score based on `optimizationMetric` (including composite metrics)
7. Return score to optimizer.py

### 2.3 Task Complete Endpoint

**Purpose:** Called by optimizer.py when optimization finishes successfully.

```typescript
// POST /backtest/task/:id/complete
// Request
interface CompleteTaskRequest {
  bestParams: Record<string, any>;  // Best parameters found
  bestScore: number;                // Best metric value
}

// Response
interface CompleteTaskResponse {
  success: boolean;
  task: BacktestTask;
}
```

**Implementation Logic:**

1. Update task status to `DONE`
2. Store `bestParams` in task record
3. Set `completedAt` timestamp
4. Emit `TaskCompleted` event

### 2.4 Task Fail Endpoint

**Purpose:** Called by optimizer.py when optimization fails.

```typescript
// POST /backtest/task/:id/fail
// Request
interface FailTaskRequest {
  error: string;  // Error message
}

// Response
interface FailTaskResponse {
  success: boolean;
  task: BacktestTask;
}
```

**Implementation Logic:**

1. Update task status to `FAILED`
2. Store `errorMessage`
3. Set `completedAt` timestamp
4. Emit `TaskFailed` event

### 2.5 Optuna Dashboard Endpoints

**Purpose:** Manage the Optuna dashboard process.

```typescript
// POST /backtest/optuna-dashboard (GraphQL mutation)
interface StartDashboardInput {
  taskId: string;
  port?: number;  // Default: 8080
}

interface StartDashboardResponse {
  url: string;    // e.g., "http://localhost:8080"
  taskId: string;
}

// DELETE /backtest/optuna-dashboard (GraphQL mutation)
interface StopDashboardResponse {
  success: boolean;
}
```

**Implementation Logic:**

1. Check if dashboard process is already running
2. If running, kill it first
3. Find the SQLite DB path for the given taskId
4. Spawn `optuna-dashboard` process with the DB path
5. Store PID for later cleanup
6. Return dashboard URL

---

## Phase 3: Backtest Service Modifications

### 3.1 New Methods in BacktestService

**File:** `src/microservices/apiService/modules/backtest/backtest.service.ts`

```typescript
@Injectable()
export class BacktestService {
  // ... existing methods ...

  /**
   * Run a single backtest and return score (for optimizer.py)
   */
  async runSingleBacktest(
    taskId: string,
    configId: string,
    strategyConfig: StrategyConfig,
  ): Promise<{ success: boolean; score: number; metrics: any; error?: string }>;

  /**
   * Mark task as complete with best params (called by optimizer.py)
   */
  async completeOptunaTask(
    taskId: string,
    bestParams: Record<string, any>,
    bestScore: number,
  ): Promise<BacktestTask>;

  /**
   * Mark task as failed (called by optimizer.py)
   */
  async failOptunaTask(
    taskId: string,
    error: string,
  ): Promise<BacktestTask>;

  /**
   * Calculate score for a given metric
   * Supports both single metrics and composite formulas
   */
  calculateScore(
    metrics: BacktestMetrics,
    metricName: string,
  ): number;

  /**
   * Get Optuna study path for a task
   */
  getOptunaStudyPath(taskId: string, date: string): string;
}
```

### 3.2 Score Calculation

The service should support the same composite metrics as optimizer.py:

```typescript
const COMPOSITE_FORMULAS = {
  calmar: (m) => m.totalPnlPercent / Math.max(Math.abs(m.maxDrawdownPercent), 0.1),
  risk_adjusted: (m) => m.totalPnlPercent / (1 + Math.abs(m.maxDrawdownPercent) / 100),
  sortino_like: (m) => (m.sharpeRatio ?? 0) * (1 - Math.abs(m.maxDrawdownPercent) / 100),
  balanced: (m) => (m.sharpeRatio ?? 0) * (m.winRate / 100) * (1 - Math.abs(m.maxDrawdownPercent) / 100),
  conservative: (m) => (m.sharpeRatio ?? 0) * Math.pow(Math.max(0, 1 - Math.abs(m.maxDrawdownPercent) / 50), 2),
  aggressive: (m) => m.totalPnlPercent * Math.pow(Math.max(m.winRate, 0) / 100, 0.5),
  profit_factor_weighted: (m) => (m.profitFactor ?? 0) * (m.winRate / 100),
};

const SINGLE_METRICS = ['sharpeRatio', 'totalPnlPercent', 'winRate', 'profitFactor', 'maxDrawdownPercent'];
```

---

## Phase 4: BacktestRunnerService Modifications

### 4.1 Updated Process Logic

**File:** `src/microservices/apiService/modules/backtest/backtest-runner.service.ts`

```typescript
@Injectable()
export class BacktestRunnerService {
  // ... existing code ...

  private async processNextTask(): Promise<void> {
    const task = await this.prismaService.backtestTask.findFirst({
      where: { status: BacktestTaskStatus.AWAIT },
      orderBy: { createdAt: 'asc' },
    });

    if (!task) return;

    // Mark as processing
    await this.backtestService.markTaskProcessing(task.id);

    if (task.searchStrategy === 'optuna') {
      // Spawn optimizer.py and move on (fire & forget)
      await this.spawnOptunaOptimizer(task);
      // Don't wait - optimizer.py will call /complete or /fail when done
    } else {
      // Existing grid search logic
      await this.runGridSearch(task);
    }
  }

  /**
   * Spawn optimizer.py process for Optuna optimization
   */
  private async spawnOptunaOptimizer(task: BacktestTask): Promise<void> {
    const optimizerPath = path.join(
      process.cwd(),
      'src/backtest/optimizer/python/optimizer.py'
    );

    const configJson = JSON.stringify(task.optimizationParams);
    const runDate = new Date().toISOString().split('T')[0];

    // Build arguments
    const args = [
      optimizerPath,
      '--task-id', task.id,
      '--config', configJson,
      '--from', task.startDate.toISOString().split('T')[0],
      '--to', task.endDate.toISOString().split('T')[0],
      '--metric', task.optimizationMetric || 'sharpeRatio',
      '--direction', task.direction || 'maximize',
      '--trials', String(task.trials || 100),
      '--run-date', runDate,
    ];

    // Spawn process (fire & forget)
    const child = spawn('python3', args, {
      detached: true,
      stdio: 'ignore',
      cwd: process.cwd(),
    });

    child.unref();

    await this.logger.log({
      severity: 'Info',
      summary: `Spawned Optuna optimizer for task ${task.id}`,
      details: `PID: ${child.pid}`,
    });
  }

  /**
   * Existing grid search logic (refactored from processNextTask)
   */
  private async runGridSearch(task: BacktestTask): Promise<void> {
    // ... existing grid search implementation ...
  }
}
```

---

## Phase 5: optimizer.py Modifications

### 5.1 New CLI Arguments

```python
parser.add_argument("--task-id", required=True,
                   help="BacktestTask ID for recording results")
parser.add_argument("--config", required=True,
                   help="Factory config JSON (inline)")
parser.add_argument("--run-date", required=True,
                   help="Run date for result folder (yyyy-mm-dd)")
parser.add_argument("--api-url", default="http://localhost:3000",
                   help="NestJS API base URL")
```

### 5.2 HTTP Client for API Calls

```python
import requests

API_URL = "http://localhost:3000"

def run_backtest_via_api(
    task_id: str,
    config_id: str,
    strategy_config: dict,
) -> dict:
    """
    Call the NestJS run-single endpoint instead of ts-node.
    """
    response = requests.post(
        f"{API_URL}/backtest/run-single",
        json={
            "taskId": task_id,
            "configId": config_id,
            "strategyConfig": strategy_config,
        },
        timeout=300,
    )
    return response.json()


def complete_task(task_id: str, best_params: dict, best_score: float) -> None:
    """
    Notify NestJS that optimization completed successfully.
    """
    requests.post(
        f"{API_URL}/backtest/task/{task_id}/complete",
        json={
            "bestParams": best_params,
            "bestScore": best_score,
        },
    )


def fail_task(task_id: str, error: str) -> None:
    """
    Notify NestJS that optimization failed.
    """
    requests.post(
        f"{API_URL}/backtest/task/{task_id}/fail",
        json={"error": error},
    )
```

### 5.3 Updated Objective Function

```python
def create_objective(
    task_id: str,
    factory_config: dict,
    optimizable_params: list,
    from_date: str,
    to_date: str,
):
    """
    Objective function that calls NestJS API instead of ts-node.
    """
    def objective(trial: Trial) -> float:
        # Build concrete config from trial
        config = build_config_from_trial(factory_config, optimizable_params, trial)

        # Generate unique config ID
        config_id = str(uuid.uuid4())

        # Call NestJS API
        result = run_backtest_via_api(task_id, config_id, config)

        if not result.get("success"):
            print(f"  [FAILED] {result.get('error', 'Unknown error')}", file=sys.stderr)
            return float("-inf")

        score = result.get("score", float("-inf"))

        print(f"  Trial {trial.number}: score={score:.4f}", file=sys.stderr)

        return score

    return objective
```

### 5.4 Per-Task SQLite Storage

```python
def get_study_storage(task_id: str, run_date: str, base_dir: str = "result") -> str:
    """
    Return SQLite storage URL for per-task Optuna study.
    """
    study_dir = Path(base_dir) / run_date / task_id
    study_dir.mkdir(parents=True, exist_ok=True)

    db_path = study_dir / "optuna-study.db"
    return f"sqlite:///{db_path}"
```

### 5.5 Main Function with Error Handling

```python
def main():
    args = parse_args()

    try:
        # Parse config
        factory_config = json.loads(args.config)

        # Extract optimizable params
        optimizable_params = extract_optimizable_params(factory_config)

        # Create study with per-task storage
        storage = get_study_storage(args.task_id, args.run_date)
        study = optuna.create_study(
            study_name=f"task-{args.task_id}",
            storage=storage,
            direction=args.direction,
            load_if_exists=True,
        )

        # Create objective
        objective = create_objective(
            task_id=args.task_id,
            factory_config=factory_config,
            optimizable_params=optimizable_params,
            from_date=args.from_date,
            to_date=args.to_date,
        )

        # Run optimization
        study.optimize(objective, n_trials=args.trials, show_progress_bar=True)

        # Success - notify NestJS
        complete_task(
            args.task_id,
            best_params=study.best_params,
            best_score=study.best_value,
        )

        print(f"Optimization complete. Best score: {study.best_value:.4f}")

    except Exception as e:
        # Failure - notify NestJS
        fail_task(args.task_id, str(e))
        print(f"Optimization failed: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
```

---

## Phase 6: Dashboard Management

### 6.1 Dashboard Service

**File:** `src/microservices/apiService/modules/backtest/optuna-dashboard.service.ts`

```typescript
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';

@Injectable()
export class OptunaDashboardService implements OnModuleDestroy {
  private dashboardProcess: ChildProcess | null = null;
  private currentTaskId: string | null = null;
  private currentPort: number | null = null;

  async onModuleDestroy() {
    await this.stopDashboard();
  }

  /**
   * Start Optuna dashboard for a specific task
   */
  async startDashboard(
    taskId: string,
    studyPath: string,
    port: number = 8080,
  ): Promise<{ url: string; taskId: string }> {
    // Stop existing dashboard if running
    if (this.dashboardProcess) {
      await this.stopDashboard();
    }

    // Verify study file exists
    if (!fs.existsSync(studyPath.replace('sqlite:///', ''))) {
      throw new Error(`Optuna study not found for task ${taskId}`);
    }

    // Spawn optuna-dashboard
    this.dashboardProcess = spawn('optuna-dashboard', [studyPath, '--port', String(port)], {
      detached: false,
      stdio: 'pipe',
    });

    this.currentTaskId = taskId;
    this.currentPort = port;

    // Wait a moment for dashboard to start
    await new Promise(resolve => setTimeout(resolve, 2000));

    return {
      url: `http://localhost:${port}`,
      taskId,
    };
  }

  /**
   * Stop the running dashboard
   */
  async stopDashboard(): Promise<boolean> {
    if (!this.dashboardProcess) {
      return true;
    }

    this.dashboardProcess.kill('SIGTERM');
    this.dashboardProcess = null;
    this.currentTaskId = null;
    this.currentPort = null;

    return true;
  }

  /**
   * Get current dashboard status
   */
  getStatus(): { running: boolean; taskId: string | null; url: string | null } {
    return {
      running: this.dashboardProcess !== null,
      taskId: this.currentTaskId,
      url: this.currentPort ? `http://localhost:${this.currentPort}` : null,
    };
  }
}
```

### 6.2 GraphQL Mutations

```graphql
type OptunaDashboardStatus {
  running: Boolean!
  taskId: ID
  url: String
}

type Mutation {
  # Start Optuna dashboard for a task
  startOptunaDashboard(taskId: ID!, port: Int = 8080): OptunaDashboardStatus!

  # Stop running dashboard
  stopOptunaDashboard: Boolean!
}

type Query {
  # Get current dashboard status
  optunaDashboardStatus: OptunaDashboardStatus!
}
```

---

## Phase 7: File Structure

### 7.1 Result Folder Structure

```
result/
└── 2024-01-15/                    # Run date
    └── <taskId>/                  # Task ID
        ├── optuna-study.db        # Optuna SQLite (only for optuna tasks)
        ├── <configId-1>/          # Trial 1
        │   ├── summary.json
        │   ├── trades.json.gz
        │   ├── config.json
        │   └── equity-curve.json.gz
        ├── <configId-2>/          # Trial 2
        │   └── ...
        └── <configId-N>/          # Trial N
            └── ...
```

### 7.2 optimizationParams Format

**For Grid Search:**
```json
{
  "signal": {
    "type": "emaCrossover",
    "params": {
      "fastPeriod": [10, 20, 30],
      "slowPeriod": [50, 100, 200],
      "timeframe": [60]
    }
  },
  "filters": [],
  "risk": {
    "type": "fixed",
    "params": {
      "positionSizeUsdt": [1000]
    }
  },
  "exits": []
}
```

**For Optuna:**
```json
{
  "signal": {
    "type": "emaCrossover",
    "params": {
      "fastPeriod": { "min": 5, "max": 50 },
      "slowPeriod": { "min": 50, "max": 200 },
      "timeframe": 60
    }
  },
  "filters": [],
  "risk": {
    "type": "fixed",
    "params": {
      "positionSizeUsdt": 1000
    }
  },
  "exits": []
}
```

---

## Phase 8: Implementation Order

| Step | Task | Files | Dependencies |
|------|------|-------|--------------|
| 1 | Add Prisma schema fields | `prisma/schema.prisma` | None |
| 2 | Run migration | - | Step 1 |
| 3 | Add score calculation to BacktestService | `backtest.service.ts` | None |
| 4 | Add run-single endpoint | `backtest.controller.ts` | Step 3 |
| 5 | Add complete/fail endpoints | `backtest.controller.ts` | Step 3 |
| 6 | Update BacktestRunnerService for Optuna spawning | `backtest-runner.service.ts` | Steps 4-5 |
| 7 | Modify optimizer.py to use HTTP API | `optimizer.py` | Steps 4-5 |
| 8 | Add per-task SQLite storage to optimizer.py | `optimizer.py` | Step 7 |
| 9 | Create OptunaDashboardService | `optuna-dashboard.service.ts` | None |
| 10 | Add dashboard GraphQL endpoints | `backtest.resolver.ts` | Step 9 |
| 11 | Update DTO/entities for new fields | `dto/`, `entities/` | Steps 1-2 |
| 12 | Integration testing | - | All |

---

## Phase 9: GraphQL API Examples

### 9.1 Create Optuna Optimization Task

```graphql
mutation {
  createBacktestTask(input: {
    name: "BTC EMA Optuna Optimization"
    symbol: "BTCUSDT"
    startDate: "2023-01-01"
    endDate: "2024-01-01"
    searchStrategy: "optuna"
    optimizationMetric: "sharpeRatio"
    trials: 100
    direction: "maximize"
    optimizationParams: {
      signal: {
        type: "emaCrossover"
        params: {
          fastPeriod: { min: 5, max: 50 }
          slowPeriod: { min: 50, max: 200 }
          timeframe: 60
        }
      }
      filters: []
      risk: {
        type: "fixed"
        params: { positionSizeUsdt: 1000 }
      }
      exits: []
    }
  }) {
    id
    name
    searchStrategy
    optimizationMetric
    trials
    status
  }
}
```

### 9.2 Monitor Optimization Progress

```graphql
query {
  backtestTask(id: "task-123") {
    id
    status
    processedConfigs
    totalConfigs      # For optuna: equals trials
    searchStrategy
    bestParams        # Available after completion
  }
}
```

### 9.3 Start Optuna Dashboard

```graphql
mutation {
  startOptunaDashboard(taskId: "task-123", port: 8080) {
    running
    taskId
    url
  }
}
```

### 9.4 Get Dashboard Status

```graphql
query {
  optunaDashboardStatus {
    running
    taskId
    url
  }
}
```

---

## Phase 10: Considerations

### 10.1 Single Dashboard Limitation

Only one Optuna dashboard can be active at a time. Users must stop the current dashboard before viewing a different task.

### 10.2 Localhost-Only Endpoints

The `/run-single`, `/complete`, and `/fail` endpoints are internal and should only be accessible from localhost. This is achieved by:

1. Binding to 127.0.0.1 only (if separate from main API)
2. Or checking request origin in middleware

### 10.3 Long-Running Optimizations

For tasks with many trials (500+), the optimization may run for hours. The fire-and-forget approach ensures:

1. Cron job doesn't block
2. Progress is visible via `processedConfigs`
3. Task can be cancelled (optimizer.py should check periodically)

### 10.4 Error Recovery

If the NestJS server restarts while optimizer.py is running:

1. optimizer.py will fail on next API call
2. optimizer.py catches exception and marks task as failed
3. User can retry the task

### 10.5 Cancellation Support

To support task cancellation:

1. Add a check in optimizer.py objective function
2. Before each trial, GET task status from API
3. If status is CANCELLED, exit gracefully

---

## Summary

This integration provides:

1. **Unified task management** via GraphQL
2. **Dual optimization methods** (grid search + Optuna Bayesian)
3. **Shared result recording** to DB and filesystem
4. **Real-time progress tracking** via subscriptions
5. **Optuna dashboard access** for visualization
6. **Per-task isolation** with individual SQLite DBs

The key insight is that optimizer.py becomes a "worker" that calls back to NestJS for:
- Running individual backtests
- Recording results
- Reporting completion/failure

This keeps all data in one place while leveraging Optuna's optimization algorithms.
