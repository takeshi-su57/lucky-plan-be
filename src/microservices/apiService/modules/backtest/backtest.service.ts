import * as fs from 'fs';
import * as path from 'path';
import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { BacktestTaskStatus } from 'generated/prisma/client';
import { firstValueFrom } from 'rxjs';

import { PrismaService } from 'src/global/prisma.service';
import { PATTERNS, SERVICE_NAMES } from 'src/utils/constants';

import {
  CreateBacktestTaskInput,
  OptimizationParams,
  OptimizationComponentConfig,
} from './dto';
import {
  BacktestTask,
  TaskStats,
  BacktestComponents,
  ComponentInfo,
  ParamInfo,
} from './entities';
import { BacktestResult, ResultFolder, ResultFile } from './entities';
import {
  getAllComponentMeta,
  ParamMeta,
  ComponentMeta,
} from 'src/backtest/core/registry';
import {
  ComposableBacktestEngine,
  ExtendedMetrics,
} from 'src/backtest/composable-backtest-engine';
import { StrategyConfig, ComponentConfig } from 'src/backtest/core/interfaces';
import { WorkerPoolService } from 'src/backtest/workers/worker-pool.service';
import { WorkerInput } from 'src/backtest/workers/backtest.worker';

/**
 * Backtest metrics interface for score calculation
 */
export interface BacktestMetrics {
  sharpeRatio: number | null;
  totalPnlPercent: number;
  totalPnlUsdt: number;
  winRate: number;
  totalTrades: number;
  maxDrawdownPercent: number;
  maxDrawdownUsdt: number;
  profitFactor: number | null;
}

/**
 * Composite metric formulas
 * Higher score = better (all formulas should be maximized)
 */
const COMPOSITE_FORMULAS: Record<
  string,
  { description: string; calculate: (m: BacktestMetrics) => number }
> = {
  calmar: {
    description: 'Annual return / Max drawdown - balances return vs risk',
    calculate: (m) =>
      m.totalPnlPercent / Math.max(Math.abs(m.maxDrawdownPercent), 0.1),
  },
  risk_adjusted: {
    description: 'PnL penalized by drawdown: pnl / (1 + drawdown)',
    calculate: (m) =>
      m.totalPnlPercent / (1 + Math.abs(m.maxDrawdownPercent) / 100),
  },
  sortino_like: {
    description: 'Sharpe with drawdown penalty: sharpe * (1 - drawdown/100)',
    calculate: (m) =>
      (m.sharpeRatio ?? 0) * (1 - Math.abs(m.maxDrawdownPercent) / 100),
  },
  balanced: {
    description: 'All-around: sharpe * winRate * (1 - drawdown/100)',
    calculate: (m) =>
      (m.sharpeRatio ?? 0) *
      (m.winRate / 100) *
      (1 - Math.abs(m.maxDrawdownPercent) / 100),
  },
  conservative: {
    description: 'Heavy drawdown penalty: sharpe * (1 - drawdown/50)^2',
    calculate: (m) =>
      (m.sharpeRatio ?? 0) *
      Math.pow(Math.max(0, 1 - Math.abs(m.maxDrawdownPercent) / 50), 2),
  },
  aggressive: {
    description: 'Maximize returns: pnl * sqrt(winRate/100)',
    calculate: (m) =>
      m.totalPnlPercent * Math.pow(Math.max(m.winRate, 0) / 100, 0.5),
  },
  profit_factor_weighted: {
    description: 'Profit factor with win rate: profitFactor * winRate/100',
    calculate: (m) => (m.profitFactor ?? 0) * (m.winRate / 100),
  },
};

const SINGLE_METRICS = [
  'sharpeRatio',
  'totalPnlPercent',
  'winRate',
  'profitFactor',
  'maxDrawdownPercent',
  'totalPnlUsdt',
  'maxDrawdownUsdt',
  'totalTrades',
];

/**
 * Built-in directions for metrics (single source of truth)
 * All scores returned to optimizer.py are normalized so maximize is always the goal
 */
const METRIC_DIRECTIONS: Record<string, 'maximize' | 'minimize'> = {
  // Maximize (higher is better)
  sharpeRatio: 'maximize',
  totalPnlPercent: 'maximize',
  totalPnlUsdt: 'maximize',
  winRate: 'maximize',
  profitFactor: 'maximize',
  totalTrades: 'maximize',

  // Minimize (lower is better) - will be flipped when normalizing
  maxDrawdownPercent: 'minimize',
  maxDrawdownUsdt: 'minimize',

  // Composite metrics (all maximize)
  calmar: 'maximize',
  risk_adjusted: 'maximize',
  sortino_like: 'maximize',
  balanced: 'maximize',
  conservative: 'maximize',
  aggressive: 'maximize',
  profit_factor_weighted: 'maximize',
};

/**
 * Score value for failed/invalid trials
 * Cannot use Number.NEGATIVE_INFINITY because JSON.stringify converts it to null
 */
const WORST_SCORE = -1e100;

@Injectable()
export class BacktestService {
  constructor(
    @Inject(SERVICE_NAMES.REDIS_SERVICE) private redisClient: ClientProxy,
    private readonly prismaService: PrismaService,
    private readonly workerPool: WorkerPoolService,
  ) {}

  /**
   * Get available backtest components with their metadata
   */
  getComponents(): BacktestComponents {
    const meta = getAllComponentMeta();

    const mapParams = (params: ParamMeta[]): ParamInfo[] =>
      params.map((p) => ({
        name: p.name,
        type: p.type,
        required: p.required,
        default: p.default?.toString(),
        description: p.description,
        min: p.min,
        max: p.max,
        options: p.options,
      }));

    const mapComponents = (
      components: Record<string, ComponentMeta>,
    ): ComponentInfo[] =>
      Object.entries(components).map(([key, comp]) => ({
        name: key,
        description: comp.description,
        params: mapParams(comp.params),
      }));

    return {
      signals: mapComponents(meta.signals),
      filters: mapComponents(meta.filters),
      risk: mapComponents(meta.risk),
      exits: mapComponents(meta.exits),
      platforms: mapComponents(meta.platforms),
    };
  }

  /**
   * Calculate total number of configurations from optimization params
   * Uses cartesian product of all param arrays
   */
  calculateTotalConfigs(params: OptimizationParams): number {
    let total = 1;

    // Helper to count combinations for a component's params
    const countComponentCombinations = (
      component: OptimizationComponentConfig,
    ): number => {
      let count = 1;
      for (const values of Object.values(component.params)) {
        if (Array.isArray(values) && values.length > 0) {
          count *= values.length;
        }
      }
      return count;
    };

    // Signal - single signal component contributes its combinations
    total *= countComponentCombinations(params.signal);

    // Filters (optional)
    if (params.filters) {
      for (const filter of params.filters) {
        total *= countComponentCombinations(filter);
      }
    }

    // Risk
    total *= countComponentCombinations({
      type: params.risk.type,
      params: params.risk.params,
    });

    // Exits
    for (const exit of params.exits) {
      total *= countComponentCombinations(exit);
    }

    // Initial capital variations
    if (params.settings.initialCapital.length > 0) {
      total *= params.settings.initialCapital.length;
    }

    return total;
  }

  /**
   * Generate cartesian product of all param combinations for a component
   */
  private generateComponentCombinations(
    component: OptimizationComponentConfig,
  ): ComponentConfig[] {
    const paramNames = Object.keys(component.params);

    if (paramNames.length === 0) {
      return [{ type: component.type, params: {} }];
    }

    // Get all param value arrays
    const paramArrays = paramNames.map((name) => {
      const values = component.params[name];
      return Array.isArray(values) && values.length > 0 ? values : [undefined];
    });

    // Generate cartesian product
    const cartesian = this.cartesianProduct(paramArrays);

    return cartesian.map((combination) => {
      const params: Record<string, unknown> = {};
      for (let i = 0; i < paramNames.length; i++) {
        if (combination[i] !== undefined) {
          params[paramNames[i]] = combination[i];
        }
      }
      return { type: component.type, params };
    });
  }

  /**
   * Cartesian product of arrays
   */
  private cartesianProduct<T>(arrays: T[][]): T[][] {
    if (arrays.length === 0) {
      return [[]];
    }

    const [first, ...rest] = arrays;
    const restProduct = this.cartesianProduct(rest);
    const result: T[][] = [];

    for (const item of first) {
      for (const restCombination of restProduct) {
        result.push([item, ...restCombination]);
      }
    }

    return result;
  }

  /**
   * Generate all configuration combinations from optimization params
   */
  generateConfigurations(
    symbol: string,
    name: string,
    params: OptimizationParams,
  ): StrategyConfig[] {
    const configs: StrategyConfig[] = [];

    // Generate all signal combinations
    const signalCombinations = this.generateComponentCombinations(
      params.signal,
    );

    // Generate all filter combinations
    const filterCombinations: ComponentConfig[][] = params.filters
      ? params.filters.map((filter) =>
          this.generateComponentCombinations(filter),
        )
      : [[]];

    // Generate all risk combinations
    const riskCombinations = this.generateComponentCombinations({
      type: params.risk.type,
      params: params.risk.params,
    });

    // Generate all exit combinations
    const exitCombinations: ComponentConfig[][] = params.exits.map((exit) =>
      this.generateComponentCombinations(exit),
    );

    // Generate all platform combinations
    const platformCombinations = this.generateComponentCombinations({
      type: params.platform.type,
      params: params.platform.params,
    });

    // Generate cartesian product of all component combinations
    const filterProduct = this.cartesianProductOfArrays(filterCombinations);
    const exitProduct = this.cartesianProductOfArrays(exitCombinations);

    let configIndex = 0;
    for (const signal of signalCombinations) {
      for (const filters of filterProduct) {
        for (const risk of riskCombinations) {
          for (const exits of exitProduct) {
            for (const platform of platformCombinations) {
              for (const initialCapital of params.settings.initialCapital) {
                // Build config name from key params
                const configName = this.buildConfigName(
                  name,
                  signal,
                  configIndex,
                );

                const config: StrategyConfig = {
                  symbol,
                  name: configName,
                  signal,
                  filters: filters.length > 0 ? filters : [],
                  risk,
                  exits,
                  platform,
                  settings: { initialCapital },
                };

                configIndex++;
                configs.push(config);
              }
            }
          }
        }
      }
    }

    return configs;
  }

  /**
   * Cartesian product of arrays of arrays
   */
  private cartesianProductOfArrays<T>(arrays: T[][]): T[][] {
    if (arrays.length === 0) {
      return [[]];
    }

    if (arrays.length === 1) {
      return arrays[0].map((item) => [item]);
    }

    const [first, ...rest] = arrays;
    const restProduct = this.cartesianProductOfArrays(rest);
    const result: T[][] = [];

    for (const item of first) {
      for (const restCombination of restProduct) {
        result.push([item, ...restCombination]);
      }
    }

    return result;
  }

  /**
   * Build a descriptive config name from signal
   */
  private buildConfigName(
    baseName: string,
    signal: ComponentConfig,
    index: number,
  ): string {
    // Try to extract key params for naming
    let signalDescription: string;
    if (signal.type === 'emaCrossover') {
      const fast = signal.params.fastPeriod ?? 20;
      const slow = signal.params.slowPeriod ?? 50;
      signalDescription = `EMA(${fast}/${slow})`;
    } else {
      signalDescription = signal.type;
    }

    return `${baseName} #${index + 1} - ${signalDescription}`;
  }

  /**
   * Create a new backtest optimization task
   */
  async createTask(input: CreateBacktestTaskInput): Promise<BacktestTask> {
    const searchStrategy = input.searchStrategy || 'grid';

    // Calculate total configs based on search strategy
    let totalConfigs: number;

    if (searchStrategy === 'optuna') {
      // For optuna, totalConfigs equals the number of trials
      totalConfigs = input.trials || 100;
    } else {
      // For grid search, calculate cartesian product
      totalConfigs = this.calculateTotalConfigs(input.optimizationParams);
    }

    const task = await this.prismaService.backtestTask.create({
      data: {
        name: input.name,
        symbol: input.symbol.toUpperCase(),
        optimizationParams: input.optimizationParams as object,
        startDate: input.startDate,
        endDate: input.endDate,
        interval: input.interval || '1m',
        status: BacktestTaskStatus.AWAIT,
        totalConfigs,
        processedConfigs: 0,
        // Optuna-specific fields
        searchStrategy,
        optimizationMetrics: input.optimizationMetrics || ['sharpeRatio'],
        trials: input.trials,
      },
    });

    await firstValueFrom(
      this.redisClient.emit(PATTERNS.Backtest.TaskCreated, task),
    );

    return task;
  }

  /**
   * Get a single task by ID
   */
  async getTask(id: string): Promise<BacktestTask | null> {
    const task = await this.prismaService.backtestTask.findUnique({
      where: { id },
    });

    return task;
  }

  /**
   * Get tasks with optional filtering
   */
  async getTasks(options: {
    status?: BacktestTaskStatus;
    symbol?: string;
    limit?: number;
    offset?: number;
  }): Promise<BacktestTask[]> {
    const tasks = await this.prismaService.backtestTask.findMany({
      where: {
        ...(options.status && { status: options.status }),
        ...(options.symbol && { symbol: options.symbol.toUpperCase() }),
      },
      orderBy: { createdAt: 'desc' },
      take: options.limit || 20,
      skip: options.offset || 0,
    });

    return tasks;
  }

  /**
   * Get task statistics by status
   */
  async getTaskStats(): Promise<TaskStats> {
    const [awaitCount, processingCount, doneCount, failedCount] =
      await Promise.all([
        this.prismaService.backtestTask.count({
          where: { status: BacktestTaskStatus.AWAIT },
        }),
        this.prismaService.backtestTask.count({
          where: { status: BacktestTaskStatus.PROCESSING },
        }),
        this.prismaService.backtestTask.count({
          where: { status: BacktestTaskStatus.DONE },
        }),
        this.prismaService.backtestTask.count({
          where: { status: BacktestTaskStatus.FAILED },
        }),
      ]);

    return {
      await: awaitCount,
      processing: processingCount,
      done: doneCount,
      failed: failedCount,
    };
  }

  /**
   * Cancel a running or pending task
   */
  async cancelTask(id: string): Promise<BacktestTask> {
    const task = await this.prismaService.backtestTask.findUnique({
      where: { id },
    });

    if (!task) {
      throw new NotFoundException(`Task ${id} not found`);
    }

    if (
      task.status !== BacktestTaskStatus.AWAIT &&
      task.status !== BacktestTaskStatus.PROCESSING
    ) {
      throw new Error('Can only cancel pending or processing tasks');
    }

    // Kill optimizer process if running
    if (task.optimizerPid) {
      try {
        process.kill(task.optimizerPid, 'SIGTERM');
      } catch {
        // Process may already be dead
      }
    }

    const updated = await this.prismaService.backtestTask.update({
      where: { id },
      data: {
        status: BacktestTaskStatus.CANCELLED,
        completedAt: new Date(),
        optimizerPid: null,
      },
    });

    await firstValueFrom(
      this.redisClient.emit(PATTERNS.Backtest.TaskUpdated, updated),
    );

    return updated;
  }

  /**
   * Delete a task and its results (both DB and filesystem)
   */
  async deleteTask(id: string): Promise<boolean> {
    const task = await this.prismaService.backtestTask.findUnique({
      where: { id },
    });

    if (!task) {
      throw new NotFoundException(`Task ${id} not found`);
    }

    // Delete result files from filesystem
    this.deleteResultFolder(
      id,
      task.startDate?.toISOString().split('T')[0] || '',
    );

    // Cascade delete will remove results from DB
    await this.prismaService.backtestTask.delete({
      where: { id },
    });

    return true;
  }

  /**
   * Delete a single backtest result (both DB and filesystem)
   */
  async deleteResult(resultId: string): Promise<boolean> {
    const result = await this.prismaService.backtestResult.findUnique({
      where: { id: resultId },
    });

    if (!result) {
      throw new NotFoundException(`Result ${resultId} not found`);
    }

    // Delete result files from filesystem
    if (result.resultFolder) {
      this.deleteResultFolder(result.taskId, result.runDate, result.configId);
    }

    // Delete from DB
    await this.prismaService.backtestResult.delete({
      where: { id: resultId },
    });

    return true;
  }

  /**
   * Delete result folder from filesystem
   * Can delete entire task folder or specific config folder
   */
  private deleteResultFolder(
    taskId: string,
    date: string,
    configId?: string,
    baseDir: string = 'result',
  ): void {
    let folderPath: string;

    if (configId) {
      // Delete specific config folder
      folderPath = path.join(baseDir, date, taskId, configId);
    } else {
      // Delete entire task folder
      folderPath = path.join(baseDir, date, taskId);
    }

    if (fs.existsSync(folderPath)) {
      fs.rmSync(folderPath, { recursive: true, force: true });
    }
  }

  /**
   * Retry a failed task
   */
  async retryTask(id: string): Promise<BacktestTask> {
    const task = await this.prismaService.backtestTask.findUnique({
      where: { id },
    });

    if (!task) {
      throw new NotFoundException(`Task ${id} not found`);
    }

    if (task.status !== BacktestTaskStatus.FAILED) {
      throw new Error('Can only retry failed tasks');
    }

    const updated = await this.prismaService.backtestTask.update({
      where: { id },
      data: {
        status: BacktestTaskStatus.AWAIT,
        errorMessage: null,
        startedAt: null,
        completedAt: null,
      },
    });

    await firstValueFrom(
      this.redisClient.emit(PATTERNS.Backtest.TaskCreated, updated),
    );

    return updated;
  }

  /**
   * Update task progress
   */
  async updateTaskProgress(
    id: string,
    processedConfigs: number,
    currentConfig?: string,
  ): Promise<void> {
    const updated = await this.prismaService.backtestTask.update({
      where: { id },
      data: {
        processedConfigs,
        currentConfig,
      },
    });

    await firstValueFrom(
      this.redisClient.emit(PATTERNS.Backtest.TaskUpdated, updated),
    );
  }

  /**
   * Atomically increment task progress to avoid race conditions
   */
  async incrementTaskProgress(
    id: string,
    currentConfig?: string,
  ): Promise<void> {
    const updated = await this.prismaService.backtestTask.update({
      where: { id },
      data: {
        processedConfigs: { increment: 1 },
        currentConfig,
      },
    });

    await firstValueFrom(
      this.redisClient.emit(PATTERNS.Backtest.TaskUpdated, updated),
    );
  }

  /**
   * Mark task as processing
   */
  async markTaskProcessing(id: string): Promise<void> {
    const updated = await this.prismaService.backtestTask.update({
      where: { id },
      data: {
        status: BacktestTaskStatus.PROCESSING,
        startedAt: new Date(),
      },
    });

    await firstValueFrom(
      this.redisClient.emit(PATTERNS.Backtest.TaskUpdated, updated),
    );
  }

  /**
   * Mark task as completed
   */
  async markTaskCompleted(id: string): Promise<void> {
    const updated = await this.prismaService.backtestTask.update({
      where: { id },
      data: {
        status: BacktestTaskStatus.DONE,
        completedAt: new Date(),
        currentConfig: null,
      },
    });

    await firstValueFrom(
      this.redisClient.emit(PATTERNS.Backtest.TaskCompleted, updated),
    );
  }

  /**
   * Mark task as failed
   */
  async markTaskFailed(id: string, errorMessage: string): Promise<void> {
    const updated = await this.prismaService.backtestTask.update({
      where: { id },
      data: {
        status: BacktestTaskStatus.FAILED,
        completedAt: new Date(),
        errorMessage,
        currentConfig: null,
      },
    });

    await firstValueFrom(
      this.redisClient.emit(PATTERNS.Backtest.TaskFailed, updated),
    );
  }

  /**
   * Save backtest result
   */
  async saveResult(
    taskId: string,
    configId: string,
    runDate: string,
    strategyConfig: StrategyConfig,
    result: {
      totalTrades: number;
      winningTrades: number;
      losingTrades: number;
      winRate: number;
      totalPnlUsdt: number;
      totalPnlPercent: number;
      maxDrawdownUsdt: number;
      maxDrawdownPercent: number;
    },
    metrics: ExtendedMetrics,
    resultFolder: string,
  ): Promise<BacktestResult> {
    const saved = await this.prismaService.backtestResult.create({
      data: {
        taskId,
        configId,
        runDate,
        strategyConfig: strategyConfig as object,
        totalTrades: result.totalTrades,
        winningTrades: result.winningTrades,
        losingTrades: result.losingTrades,
        winRate: result.winRate,
        totalPnlUsdt: result.totalPnlUsdt,
        totalPnlPercent: result.totalPnlPercent,
        maxDrawdownUsdt: result.maxDrawdownUsdt,
        maxDrawdownPercent: result.maxDrawdownPercent,
        sharpeRatio: metrics.sharpeRatio,
        profitFactor: metrics.profitFactor,
        resultFolder,
      },
    });

    await firstValueFrom(
      this.redisClient.emit(PATTERNS.Backtest.ResultCreated, saved),
    );

    return saved;
  }

  /**
   * Get results for a task with sorting and pagination
   */
  async getResults(options: {
    taskId: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
    limit?: number;
    offset?: number;
  }): Promise<BacktestResult[]> {
    const sortField = options.sortBy || 'totalPnlUsdt';
    const sortOrder = options.sortOrder || 'desc';

    const results = await this.prismaService.backtestResult.findMany({
      where: { taskId: options.taskId },
      orderBy: { [sortField]: sortOrder },
      take: options.limit || 50,
      skip: options.offset || 0,
    });

    return results;
  }

  /**
   * Get top performing results
   */
  async getTopResults(
    taskId: string,
    metric: string = 'totalPnlUsdt',
    limit: number = 10,
  ): Promise<BacktestResult[]> {
    const results = await this.prismaService.backtestResult.findMany({
      where: { taskId },
      orderBy: { [metric]: 'desc' },
      take: limit,
    });

    return results;
  }

  /**
   * Get result dates for a task
   */
  getResultDates(taskId: string): string[] {
    return ComposableBacktestEngine.listResultDates(taskId);
  }

  /**
   * Get result folders for a task and date
   */
  getResultFolders(taskId: string, date: string): ResultFolder[] {
    const folders = ComposableBacktestEngine.listResultFolders(taskId, date);
    return folders.map((f) => ({
      date,
      taskId,
      configId: f.configId,
      files: f.files,
    }));
  }

  /**
   * Get a specific result file
   */
  getResultFile(
    taskId: string,
    date: string,
    configId: string,
    fileName: string,
  ): ResultFile | null {
    const result = ComposableBacktestEngine.readResultFile(
      taskId,
      date,
      configId,
      fileName,
    );

    if (!result) {
      return null;
    }

    return {
      name: fileName,
      content: result.content,
      contentType: result.contentType,
      size: result.size,
      originalSize: result.originalSize,
      isCompressed: result.isCompressed,
    };
  }

  // ==================== OPTUNA INTEGRATION METHODS ====================

  /**
   * Calculate score for a given metric
   * Supports both single metrics and composite formulas
   */
  calculateScore(metrics: BacktestMetrics, metricName: string): number | null {
    // Check if it's a composite metric
    if (metricName in COMPOSITE_FORMULAS) {
      try {
        return COMPOSITE_FORMULAS[metricName].calculate(metrics);
      } catch {
        return null;
      }
    }

    // Single metric
    if (SINGLE_METRICS.includes(metricName)) {
      const value = metrics[metricName as keyof BacktestMetrics];
      if (value === null || value === undefined) {
        return null;
      }
      return value as number;
    }

    // Unknown metric
    return null;
  }

  /**
   * Calculate normalized score - always maximize target
   * Metrics with 'minimize' direction are multiplied by -1
   */
  calculateNormalizedScore(
    metrics: BacktestMetrics,
    metricName: string,
  ): number {
    const rawScore = this.calculateScore(metrics, metricName);

    if (rawScore === null) {
      return WORST_SCORE;
    }

    const direction = METRIC_DIRECTIONS[metricName] || 'maximize';

    return direction === 'minimize' ? -rawScore : rawScore;
  }

  /**
   * Calculate normalized scores for multiple metrics
   */
  calculateNormalizedScores(
    metrics: BacktestMetrics,
    metricNames: string[],
  ): number[] {
    return metricNames.map((name) =>
      this.calculateNormalizedScore(metrics, name),
    );
  }

  /**
   * Run a single backtest and return normalized scores (for optimizer.py)
   * Delegates to worker pool to prevent blocking the event loop
   * Scores are normalized so maximize is always the goal
   */
  async runSingleBacktest(
    taskId: string,
    configId: string,
    strategyConfig: StrategyConfig,
  ): Promise<{
    success: boolean;
    scores: number[];
    metrics: BacktestMetrics;
    error?: string;
  }> {
    try {
      // Fetch task to get optimization settings
      const task = await this.prismaService.backtestTask.findUnique({
        where: { id: taskId },
      });

      if (!task) {
        return {
          success: false,
          scores: [],
          metrics: this.getEmptyMetrics(),
          error: `Task ${taskId} not found`,
        };
      }

      // Check if task is cancelled
      if (task.status === BacktestTaskStatus.CANCELLED) {
        return {
          success: false,
          scores: [],
          metrics: this.getEmptyMetrics(),
          error: 'Task was cancelled',
        };
      }

      // Prepare worker input
      const workerInput: WorkerInput = {
        strategyConfig,
        symbol: strategyConfig.symbol,
        interval: task.interval,
        startDate: task.startDate.toISOString(),
        endDate: task.endDate.toISOString(),
        taskId,
        configId,
      };

      // Delegate to worker pool (non-blocking)
      const workerResult = await this.workerPool.runBacktest(workerInput);

      if (
        !workerResult.success ||
        !workerResult.result ||
        !workerResult.metrics
      ) {
        return {
          success: false,
          scores: [],
          metrics: this.getEmptyMetrics(),
          error: workerResult.error || 'Unknown worker error',
        };
      }

      // Get run date
      const runDate = new Date().toISOString().split('T')[0];

      // Save result to database (I/O bound, non-blocking)
      await this.saveResult(
        taskId,
        configId,
        runDate,
        strategyConfig,
        workerResult.result,
        workerResult.extendedMetrics!,
        workerResult.exportFolder!,
      );

      // Update progress atomically to avoid race conditions
      await this.incrementTaskProgress(taskId, configId);

      // Calculate normalized scores for all optimization metrics
      const scores = this.calculateNormalizedScores(
        workerResult.metrics,
        task.optimizationMetrics,
      );

      return {
        success: true,
        scores,
        metrics: workerResult.metrics,
      };
    } catch (error) {
      return {
        success: false,
        scores: [],
        metrics: this.getEmptyMetrics(),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get empty metrics object for error cases
   */
  private getEmptyMetrics(): BacktestMetrics {
    return {
      sharpeRatio: null,
      totalPnlPercent: 0,
      totalPnlUsdt: 0,
      winRate: 0,
      totalTrades: 0,
      maxDrawdownPercent: 0,
      maxDrawdownUsdt: 0,
      profitFactor: null,
    };
  }

  /**
   * Mark optuna task as complete with Pareto-optimal config IDs
   * Called by optimizer.py when optimization finishes successfully
   * Results already exist in DB from optimization runs - no re-running needed
   */
  async completeOptunaTask(
    taskId: string,
    bestConfigIds: string[],
  ): Promise<BacktestTask> {
    const task = await this.prismaService.backtestTask.findUnique({
      where: { id: taskId },
    });

    if (!task) {
      throw new NotFoundException(`Task ${taskId} not found`);
    }

    // Update task with bestConfigIds directly (results already exist in DB)
    const updated = await this.prismaService.backtestTask.update({
      where: { id: taskId },
      data: {
        status: BacktestTaskStatus.DONE,
        completedAt: new Date(),
        currentConfig: null,
        bestConfigIds,
        optimizerPid: null,
      },
    });

    await firstValueFrom(
      this.redisClient.emit(PATTERNS.Backtest.TaskCompleted, updated),
    );

    return updated;
  }

  /**
   * Mark optuna task as failed
   * Called by optimizer.py when optimization fails
   */
  async failOptunaTask(taskId: string, error: string): Promise<BacktestTask> {
    const task = await this.prismaService.backtestTask.findUnique({
      where: { id: taskId },
    });

    if (!task) {
      throw new NotFoundException(`Task ${taskId} not found`);
    }

    const updated = await this.prismaService.backtestTask.update({
      where: { id: taskId },
      data: {
        status: BacktestTaskStatus.FAILED,
        completedAt: new Date(),
        errorMessage: error,
        currentConfig: null,
        optimizerPid: null,
      },
    });

    await firstValueFrom(
      this.redisClient.emit(PATTERNS.Backtest.TaskFailed, updated),
    );

    return updated;
  }

  /**
   * Resume an Optuna optimization task
   * If additionalTrials > 0, extends the task
   * Resets status to AWAIT to trigger the runner
   */
  async resumeOptunaTask(
    taskId: string,
    additionalTrials: number = 0,
  ): Promise<BacktestTask> {
    const task = await this.prismaService.backtestTask.findUnique({
      where: { id: taskId },
    });

    if (!task) {
      throw new NotFoundException(`Task ${taskId} not found`);
    }

    if (task.searchStrategy !== 'optuna') {
      throw new Error('Can only resume Optuna optimization tasks');
    }

    // Determine new trial count
    let trials = task.trials || 100;
    if (additionalTrials > 0) {
      trials += additionalTrials;
    }

    // Update task
    const updated = await this.prismaService.backtestTask.update({
      where: { id: taskId },
      data: {
        status: BacktestTaskStatus.AWAIT, // Reset to AWAIT to trigger runner
        trials,
        totalConfigs: trials, // For Optuna, totalConfigs = trials
        errorMessage: null, // Clear error if any
        completedAt: null, // Clear completion time
        optimizerPid: null, // Clear PID just in case
        bestConfigIds: [], // Clear best configs to prevent confusion
      },
    });

    await firstValueFrom(
      this.redisClient.emit(PATTERNS.Backtest.TaskUpdated, updated),
    );

    return updated;
  }

  /**
   * Check if task is cancelled (for optimizer.py to poll)
   */
  async isTaskCancelled(taskId: string): Promise<boolean> {
    const task = await this.prismaService.backtestTask.findUnique({
      where: { id: taskId },
      select: { status: true },
    });

    return task?.status === BacktestTaskStatus.CANCELLED;
  }

  // ==================== HEARTBEAT MANAGEMENT ====================

  /**
   * Record heartbeat from optimizer.py
   * Updates lastHeartbeat timestamp and optional progress info
   * Emits Redis event for real-time subscription updates
   */
  async recordHeartbeat(
    taskId: string,
    currentTrial?: number,
    trialProgress?: string,
  ): Promise<{ success: boolean; status: BacktestTaskStatus }> {
    const task = await this.prismaService.backtestTask.findUnique({
      where: { id: taskId },
      select: { status: true },
    });

    if (!task) {
      throw new NotFoundException(`Task ${taskId} not found`);
    }

    // Build update data - only include fields that are provided
    const updateData: {
      lastHeartbeat: Date;
      currentTrial?: number;
      trialProgress?: string;
    } = {
      lastHeartbeat: new Date(),
    };

    if (currentTrial !== undefined) {
      updateData.currentTrial = currentTrial;
    }

    if (trialProgress !== undefined) {
      updateData.trialProgress = trialProgress;
    }

    const updated = await this.prismaService.backtestTask.update({
      where: { id: taskId },
      data: updateData,
    });

    // Emit Redis event for real-time updates
    await firstValueFrom(
      this.redisClient.emit(PATTERNS.Backtest.TaskUpdated, updated),
    );

    return {
      success: true,
      status: task.status,
    };
  }

  /**
   * Handle reconnection request from optimizer.py
   * Called when optimizer detects NestJS may have restarted
   * Returns task state for optimizer to decide whether to continue
   */
  async handleReconnect(taskId: string): Promise<{
    success: boolean;
    status: BacktestTaskStatus;
    shouldContinue: boolean;
    processedConfigs: number;
    totalConfigs: number;
  }> {
    const task = await this.prismaService.backtestTask.findUnique({
      where: { id: taskId },
    });

    if (!task) {
      throw new NotFoundException(`Task ${taskId} not found`);
    }

    // Determine if optimizer should continue based on task status
    const shouldContinue =
      task.status === BacktestTaskStatus.PROCESSING ||
      task.status === BacktestTaskStatus.AWAIT;

    // Update heartbeat on reconnect to reset stale detection
    if (shouldContinue) {
      await this.prismaService.backtestTask.update({
        where: { id: taskId },
        data: { lastHeartbeat: new Date() },
      });
    }

    return {
      success: true,
      status: task.status,
      shouldContinue,
      processedConfigs: task.processedConfigs,
      totalConfigs: task.totalConfigs,
    };
  }
}
