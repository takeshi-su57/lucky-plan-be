import { Injectable, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BacktestTaskStatus } from 'generated/prisma/client';
import { v4 as uuidv4 } from 'uuid';

import { PrismaService } from 'src/global/prisma.service';
import { LogsService } from 'src/global/logs.service';

import { BacktestService } from './backtest.service';
import { ComposableStrategy } from 'src/backtest/core/strategy-composer';
import {
  ComposableBacktestEngine,
  ExportOptions,
} from 'src/backtest/composable-backtest-engine';
import { streamPriceData } from 'src/backtest/binance-fetcher';
import { StrategyConfig } from 'src/backtest/core/interfaces';
import { OptimizationParams } from './dto';
import { getReadableError } from 'src/utils';

@Injectable()
export class BacktestRunnerService implements OnModuleInit {
  private isProcessing = false;
  private shouldStop = false;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly backtestService: BacktestService,
    private readonly logger: LogsService,
  ) {}

  async onModuleInit() {
    await this.logger.log({
      severity: 'Info',
      summary: 'BacktestRunnerService initialized',
    });
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
   * Process the next pending task
   */
  private async processNextTask(): Promise<void> {
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
      details: `Task ID: ${task.id}, Symbol: ${task.symbol}`,
    });

    try {
      // Mark as processing
      await this.backtestService.markTaskProcessing(task.id);

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

      await this.logger.log({
        severity: 'Info',
        summary: `Task ${task.id} completed`,
        details: `Processed ${processedCount} configurations`,
      });
    } catch (error) {
      await this.backtestService.markTaskFailed(
        task.id,
        getReadableError(error),
      );

      await this.logger.log({
        severity: 'Error',
        summary: `Task ${task.id} failed`,
        details: getReadableError(error),
      });
    }
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
      capitalBase: config.settings?.capitalBase ?? 10000,
    });

    // Stream price data and run backtest
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
