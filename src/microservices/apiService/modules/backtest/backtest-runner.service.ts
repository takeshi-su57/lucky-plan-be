import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BacktestTaskStatus, BacktestTask } from 'generated/prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { spawn } from 'child_process';
import * as path from 'path';

import { PrismaService } from 'src/global/prisma.service';
import { LogsService } from 'src/global/logs.service';

import { BacktestService } from './backtest.service';
import { TemplateSearchService } from './template-search.service';
import { ComposableStrategy } from 'src/backtest/core/strategy-composer';
import {
  ComposableBacktestEngine,
  ExportOptions,
} from 'src/backtest/composable-backtest-engine';
import { streamPriceData } from 'src/backtest/binance-fetcher';
import { StrategyConfig } from 'src/backtest/core/interfaces';
import { OptimizationParams } from './dto';
import { getReadableError } from 'src/utils';

// Heartbeat monitoring constants
const HEARTBEAT_STALE_THRESHOLD_MS = 60 * 1000; // 60 seconds without heartbeat = stale
const HEARTBEAT_FORCE_KILL_THRESHOLD_MS = 3 * 60 * 1000; // 3 minutes = force kill
const INITIAL_HEARTBEAT_GRACE_PERIOD_MS = 30 * 1000; // 30 seconds grace period after task start

@Injectable()
export class BacktestRunnerService implements OnModuleInit, OnModuleDestroy {
  private isProcessing = false;
  private shouldStop = false;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly backtestService: BacktestService,
    private readonly templateSearchService: TemplateSearchService,
    private readonly logger: LogsService,
  ) {}

  async onModuleInit() {
    await this.logger.log({
      severity: 'Info',
      summary: 'BacktestRunnerService initialized',
    });
  }

  /**
   * Cleanup running optimizer processes on shutdown
   */
  async onModuleDestroy() {
    await this.logger.log({
      severity: 'Info',
      summary: 'BacktestRunnerService shutting down, cleaning up processes',
    });

    // Find all tasks with running optimizer processes
    const tasksWithProcesses = await this.prismaService.backtestTask.findMany({
      where: {
        status: BacktestTaskStatus.PROCESSING,
        optimizerPid: { not: null },
      },
    });

    for (const task of tasksWithProcesses) {
      if (task.optimizerPid) {
        try {
          process.kill(task.optimizerPid, 'SIGTERM');
          await this.logger.log({
            severity: 'Info',
            summary: `Killed optimizer process for task ${task.id}`,
            details: `PID: ${task.optimizerPid}`,
          });
        } catch {
          // Process may already be dead
        }

        // Clear PID and mark as cancelled
        await this.prismaService.backtestTask.update({
          where: { id: task.id },
          data: {
            optimizerPid: null,
            status: BacktestTaskStatus.CANCELLED,
            errorMessage: 'Server shutdown',
          },
        });
      }
    }
  }

  /**
   * Heartbeat monitor - runs every 15 seconds to detect stale/crashed optimizers
   */
  @Cron('*/15 * * * * *')
  async monitorHeartbeats(): Promise<void> {
    try {
      // Find all PROCESSING tasks with optimizer processes
      const processingTasks = await this.prismaService.backtestTask.findMany({
        where: {
          status: BacktestTaskStatus.PROCESSING,
          searchStrategy: 'optuna', // Only Optuna tasks have heartbeats
          optimizerPid: { not: null },
        },
      });

      for (const task of processingTasks) {
        await this.checkTaskHeartbeat(task);
      }
    } catch (error) {
      await this.logger.log({
        severity: 'Error',
        summary: 'Heartbeat monitor error',
        details: getReadableError(error),
      });
    }
  }

  /**
   * Check a single task's heartbeat status and handle stale/crashed processes
   */
  private async checkTaskHeartbeat(task: BacktestTask): Promise<void> {
    const now = Date.now();
    const startedAt = task.startedAt?.getTime() || now;
    const lastHeartbeat = task.lastHeartbeat?.getTime();

    // If no heartbeat received yet, check if we're past the initial grace period
    if (!lastHeartbeat) {
      const timeSinceStart = now - startedAt;
      if (timeSinceStart < INITIAL_HEARTBEAT_GRACE_PERIOD_MS) {
        // Still within grace period - optimizer may be starting up
        return;
      }

      // Past grace period with no heartbeat - check if process is alive
      const isAlive = this.isProcessRunning(task.optimizerPid!);
      if (!isAlive) {
        await this.markTaskCrashed(
          task.id,
          'Optimizer process crashed before sending first heartbeat',
        );
        return;
      }

      // Process alive but no heartbeat after grace period - might be stuck starting
      if (timeSinceStart > HEARTBEAT_STALE_THRESHOLD_MS) {
        await this.logger.log({
          severity: 'Warning',
          summary: `Task ${task.id} optimizer has not sent heartbeat`,
          details: `Time since start: ${Math.round(timeSinceStart / 1000)}s, PID: ${task.optimizerPid}`,
        });
      }
      return;
    }

    // Calculate time since last heartbeat
    const timeSinceHeartbeat = now - lastHeartbeat;

    // Check for stale heartbeat (>60s)
    if (timeSinceHeartbeat > HEARTBEAT_STALE_THRESHOLD_MS) {
      const isAlive = this.isProcessRunning(task.optimizerPid!);

      if (!isAlive) {
        // Process is dead - mark as crashed
        await this.markTaskCrashed(
          task.id,
          `Optimizer process (PID ${task.optimizerPid}) crashed unexpectedly`,
        );
        return;
      }

      // Process alive but unresponsive - check if we should force kill
      if (timeSinceHeartbeat > HEARTBEAT_FORCE_KILL_THRESHOLD_MS) {
        await this.forceKillAndFail(
          task.id,
          task.optimizerPid!,
          `Optimizer unresponsive for ${Math.round(timeSinceHeartbeat / 1000)}s - force killed`,
        );
        return;
      }

      // Log warning for stale but not yet force-kill threshold
      await this.logger.log({
        severity: 'Warning',
        summary: `Task ${task.id} heartbeat stale`,
        details: `Last heartbeat: ${Math.round(timeSinceHeartbeat / 1000)}s ago, PID: ${task.optimizerPid} (alive)`,
      });
    }
  }

  /**
   * Check if a process is running by sending signal 0
   */
  private isProcessRunning(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Mark task as failed due to optimizer crash
   */
  private async markTaskCrashed(
    taskId: string,
    errorMessage: string,
  ): Promise<void> {
    await this.prismaService.backtestTask.update({
      where: { id: taskId },
      data: {
        status: BacktestTaskStatus.FAILED,
        completedAt: new Date(),
        errorMessage,
        optimizerPid: null,
      },
    });

    await this.logger.log({
      severity: 'Error',
      summary: `Task ${taskId} marked as FAILED`,
      details: errorMessage,
    });

    // Update parent search if applicable
    await this.onTaskCompleted(taskId);
  }

  /**
   * Force kill unresponsive optimizer and mark task as failed
   */
  private async forceKillAndFail(
    taskId: string,
    pid: number,
    errorMessage: string,
  ): Promise<void> {
    // Try SIGTERM first, then SIGKILL
    try {
      process.kill(pid, 'SIGTERM');
      // Give it a moment to terminate gracefully
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Check if still alive
      if (this.isProcessRunning(pid)) {
        process.kill(pid, 'SIGKILL');
      }
    } catch {
      // Process may already be dead
    }

    await this.markTaskCrashed(taskId, errorMessage);
  }

  /**
   * Scheduled job - runs every 30 seconds to check for pending tasks
   */
  @Cron(CronExpression.EVERY_30_SECONDS)
  async processQueue(): Promise<void> {
    if (this.isProcessing) return;

    this.isProcessing = true;
    this.shouldStop = false;

    try {
      await this.processNextTask();
    } catch (error) {
      await this.logger.log({
        severity: 'Error',
        summary: 'BacktestRunnerService error',
        details: getReadableError(error),
      });
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Stop current processing (called when task is cancelled)
   */
  stopProcessing(): void {
    this.shouldStop = true;
  }

  /**
   * Hook called after a task completes (success or failure)
   * Updates parent TemplateSearch status if task belongs to one
   */
  async onTaskCompleted(taskId: string): Promise<void> {
    const task = await this.prismaService.backtestTask.findUnique({
      where: { id: taskId },
    });

    if (task?.templateSearchId) {
      await this.templateSearchService.updateSearchStatus(
        task.templateSearchId,
      );
    }
  }

  /**
   * Process the next pending task
   * Only processes one task at a time - blocks new tasks while one is PROCESSING
   */
  private async processNextTask(): Promise<void> {
    // Check if there's already a task being processed
    const processingTask = await this.prismaService.backtestTask.findFirst({
      where: { status: BacktestTaskStatus.PROCESSING },
    });

    if (processingTask) {
      // Already processing a task, don't pick up new ones
      return;
    }

    // Get next AWAIT task
    const task = await this.prismaService.backtestTask.findFirst({
      where: { status: BacktestTaskStatus.AWAIT },
      orderBy: { createdAt: 'asc' },
    });

    if (!task) {
      return; // No pending tasks
    }

    await this.logger.log({
      severity: 'Info',
      summary: `Starting backtest task: ${task.name}`,
      details: `Task ID: ${task.id}, Symbol: ${task.symbol}, Strategy: ${task.searchStrategy}`,
    });

    try {
      // Mark as processing
      await this.backtestService.markTaskProcessing(task.id);

      // If task belongs to a TemplateSearch, mark the search as PROCESSING
      if (task.templateSearchId) {
        const search = await this.prismaService.templateSearch.findUnique({
          where: { id: task.templateSearchId },
        });
        if (search?.status === 'AWAIT') {
          await this.templateSearchService.markSearchProcessing(
            task.templateSearchId,
          );
        }
      }

      // Check search strategy
      if (task.searchStrategy === 'optuna') {
        // Spawn optimizer.py and move on (fire & forget)
        await this.spawnOptunaOptimizer(task);
        // Don't wait - optimizer.py will call /complete or /fail when done
      } else {
        // Existing grid search logic
        await this.runGridSearch(task);
      }
    } catch (error) {
      await this.backtestService.markTaskFailed(
        task.id,
        getReadableError(error),
      );

      // Update parent search progress if applicable
      await this.onTaskCompleted(task.id);

      await this.logger.log({
        severity: 'Error',
        summary: `Task ${task.id} failed`,
        details: getReadableError(error),
      });
    }
  }

  /**
   * Spawn optimizer.py process for Optuna optimization
   * Uses run-optimizer.sh to properly handle venv activation
   * Fire-and-forget: the Python script will call back when done
   */
  private async spawnOptunaOptimizer(task: BacktestTask): Promise<void> {
    // Validate PostgreSQL URL is configured
    const postgresUrl = process.env.OPTUNA_POSTGRES_URL;
    if (!postgresUrl) {
      throw new Error(
        'OPTUNA_POSTGRES_URL environment variable is required for Optuna optimization',
      );
    }

    const runOptimizerScript = path.join(
      process.cwd(),
      'src/backtest/optimizer/run-optimizer.sh',
    );

    const configJson = JSON.stringify(task.optimizationParams);
    const studyName = `task-${task.id}`;

    // Build arguments for the optimizer script
    // run-optimizer.sh passes all arguments to optimizer.py
    const apiUrl =
      process.env.API_URL || `http://localhost:${process.env.PORT || 3000}`;
    const args = [
      runOptimizerScript,
      '--task-id',
      task.id,
      '--config',
      configJson,
      '--symbol',
      task.symbol,
      '--from',
      task.startDate.toISOString().split('T')[0],
      '--to',
      task.endDate.toISOString().split('T')[0],
      '--interval',
      task.interval,
      '--metrics',
      JSON.stringify(task.optimizationMetrics),
      '--trials',
      String(task.trials || 100),
      '--api-url',
      apiUrl,
      '--postgres-url',
      postgresUrl,
    ];

    await this.logger.log({
      severity: 'Info',
      summary: `Spawning Optuna optimizer for task ${task.id}`,
      details: `Trials: ${task.trials || 100}, Metrics: ${task.optimizationMetrics.join(', ')}, Study: ${studyName}`,
    });

    // Spawn process using bash to run the shell script
    // The shell script handles venv activation properly
    // NOTE: Change stdio to 'ignore' in production
    const child = spawn('bash', args, {
      detached: true,
      stdio: 'inherit', // DEBUG: shows optimizer output in console
      cwd: process.cwd(),
      env: {
        ...process.env,
        // Pass the internal API secret for authentication
        BACKTEST_INTERNAL_SECRET: process.env.BACKTEST_INTERNAL_SECRET || '',
      },
    });

    child.unref();

    // Store PID in database for process management
    if (child.pid) {
      await this.prismaService.backtestTask.update({
        where: { id: task.id },
        data: { optimizerPid: child.pid },
      });
    }

    await this.logger.log({
      severity: 'Info',
      summary: `Optuna optimizer spawned for task ${task.id}`,
      details: `PID: ${child.pid}, Study: ${studyName}`,
    });
  }

  /**
   * Run grid search optimization (existing logic)
   */
  private async runGridSearch(task: BacktestTask): Promise<void> {
    // Parse optimization params
    const optimizationParams =
      task.optimizationParams as unknown as OptimizationParams;

    // Generate configurations
    const configs = this.backtestService.generateConfigurations(
      task.symbol,
      task.name,
      optimizationParams,
    );

    await this.logger.log({
      severity: 'Info',
      summary: `Generated ${configs.length} configurations for task ${task.id}`,
    });

    let processedCount = 0;

    for (const config of configs) {
      // Check if we should stop
      if (this.shouldStop) {
        await this.logger.log({
          severity: 'Info',
          summary: `Task ${task.id} stopped by user`,
        });
        return;
      }

      // Check if task was cancelled
      const currentTask = await this.prismaService.backtestTask.findUnique({
        where: { id: task.id },
      });

      if (currentTask?.status === BacktestTaskStatus.CANCELLED) {
        await this.logger.log({
          severity: 'Info',
          summary: `Task ${task.id} was cancelled`,
        });
        return;
      }

      // Generate unique config ID
      const configId = uuidv4();

      // Run single backtest
      await this.runSingleBacktest(task.id, config, configId, {
        startDate: task.startDate,
        endDate: task.endDate,
        interval: task.interval,
      });

      processedCount++;

      // Update progress
      await this.backtestService.updateTaskProgress(
        task.id,
        processedCount,
        configId,
      );

      // Log progress every 10 configs
      if (processedCount % 10 === 0) {
        await this.logger.log({
          severity: 'Info',
          summary: `Task ${task.id} progress`,
          details: `Processed ${processedCount}/${task.totalConfigs} configs`,
        });
      }
    }

    // Mark as completed
    await this.backtestService.markTaskCompleted(task.id);

    // Update parent search progress if applicable
    await this.onTaskCompleted(task.id);

    await this.logger.log({
      severity: 'Info',
      summary: `Task ${task.id} completed`,
      details: `Processed ${processedCount} configurations`,
    });
  }

  /**
   * Run a single backtest with a specific configuration
   */
  private async runSingleBacktest(
    taskId: string,
    config: StrategyConfig,
    configId: string,
    options: {
      startDate: Date;
      endDate: Date;
      interval: string;
    },
  ): Promise<void> {
    // Create strategy from config
    const strategy = ComposableStrategy.fromConfig(config);

    // Create backtest engine
    const engine = new ComposableBacktestEngine(strategy, {
      symbol: config.symbol,
      initialCapital: config.settings.initialCapital,
    });

    const candleStream = streamPriceData(
      config.symbol,
      options.interval,
      options.startDate,
      options.endDate,
    );

    // Run backtest using stream
    const result = await engine.runStream(candleStream);

    // Calculate extended metrics
    const metrics = ComposableBacktestEngine.calculateExtendedMetrics(result);

    // Export results to structured folder
    const exportOptions: ExportOptions = {
      taskId,
      configId,
      baseDir: 'result',
    };

    const exportResult = await ComposableBacktestEngine.exportResults(
      result,
      config,
      exportOptions,
    );

    // Save result to database
    await this.backtestService.saveResult(
      taskId,
      configId,
      exportResult.date,
      config,
      {
        totalTrades: result.totalTrades,
        winningTrades: result.winningTrades,
        losingTrades: result.losingTrades,
        winRate: result.winRate,
        totalPnlUsdt: result.totalPnlUsdt,
        totalPnlPercent: result.totalPnlPercent,
        maxDrawdownUsdt: result.maxDrawdownUsdt,
        maxDrawdownPercent: result.maxDrawdownPercent,
      },
      metrics,
      exportResult.folder,
    );
  }
}
