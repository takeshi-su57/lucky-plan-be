import { Injectable, Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  ValidationCandidateStatus,
  WalkForwardStatus,
} from 'generated/prisma/client';

import { PrismaService } from 'src/global/prisma.service';
import { LogsService } from 'src/global/logs.service';
import { SERVICE_NAMES } from 'src/utils/constants';

import { ComposableStrategy } from 'src/backtest/core/strategy-composer';
import { ComposableBacktestEngine } from 'src/backtest/composable-backtest-engine';
import { streamPriceData } from 'src/backtest/binance-fetcher';
import { StrategyConfig } from 'src/backtest/core/interfaces';
import { getReadableError } from 'src/utils';

interface WfaWindow {
  windowIndex: number;
  trainStart: Date;
  trainEnd: Date;
  testStart: Date;
  testEnd: Date;
}

interface BacktestMetrics {
  totalTrades: number;
  winRate: number;
  totalPnlPercent: number;
  maxDrawdownPercent: number;
  sharpeRatio: number | null;
  profitFactor: number | null;
}

@Injectable()
export class WalkForwardService {
  constructor(
    @Inject(SERVICE_NAMES.REDIS_SERVICE) private redisClient: ClientProxy,
    private readonly prismaService: PrismaService,
    private readonly logger: LogsService,
  ) {}

  /**
   * Run walk-forward analysis on all PARETO_OPTIMAL candidates
   */
  async runWalkForward(pipelineId: string): Promise<void> {
    const pipeline = await this.prismaService.validationPipeline.findUnique({
      where: { id: pipelineId },
      include: {
        templateSearch: {
          include: {
            task: true,
          },
        },
      },
    });

    if (!pipeline) {
      throw new Error(`Pipeline ${pipelineId} not found`);
    }

    // Get all PARETO_OPTIMAL candidates
    const candidates = await this.prismaService.validationCandidate.findMany({
      where: {
        pipelineId,
        status: ValidationCandidateStatus.PARETO_OPTIMAL,
      },
      include: {
        result: true,
      },
    });

    if (candidates.length === 0) {
      await this.logger.log({
        severity: 'Info',
        summary: `No Pareto optimal candidates for pipeline ${pipelineId}`,
      });
      return;
    }

    await this.logger.log({
      severity: 'Info',
      summary: `Running walk-forward analysis for pipeline ${pipelineId}`,
      details: `Processing ${candidates.length} candidates with ${pipeline.wfaWindows} windows`,
    });

    const task = pipeline.templateSearch.task;
    if (!task) {
      throw new Error('Pipeline has no associated backtest task');
    }

    // Create WFA windows for each candidate
    for (const candidate of candidates) {
      // Mark candidate as WFA_PENDING
      await this.prismaService.validationCandidate.update({
        where: { id: candidate.id },
        data: { status: ValidationCandidateStatus.WFA_PENDING },
      });

      const windows = this.createWfaWindows(
        task.startDate,
        task.endDate,
        pipeline.wfaTrainRatio,
        pipeline.wfaWindows,
      );

      // Create WalkForwardResult records
      for (const window of windows) {
        await this.prismaService.walkForwardResult.create({
          data: {
            candidateId: candidate.id,
            windowIndex: window.windowIndex,
            status: WalkForwardStatus.PENDING,
            trainStart: window.trainStart,
            trainEnd: window.trainEnd,
            testStart: window.testStart,
            testEnd: window.testEnd,
          },
        });
      }
    }

    // Process WFA windows (this could be done in parallel in the runner)
    await this.processAllWfaWindows(pipelineId, task.symbol, task.interval);
  }

  /**
   * Generate walk-forward analysis windows
   */
  private createWfaWindows(
    startDate: Date,
    endDate: Date,
    trainRatio: number,
    numWindows: number,
  ): WfaWindow[] {
    const totalMs = endDate.getTime() - startDate.getTime();
    const windowMs = totalMs / numWindows;
    const trainMs = windowMs * trainRatio;

    const windows: WfaWindow[] = [];

    for (let i = 0; i < numWindows; i++) {
      const windowStart = new Date(startDate.getTime() + i * windowMs);
      const trainEnd = new Date(windowStart.getTime() + trainMs);
      const windowEnd = new Date(windowStart.getTime() + windowMs);

      windows.push({
        windowIndex: i,
        trainStart: windowStart,
        trainEnd: trainEnd,
        testStart: trainEnd,
        testEnd: windowEnd,
      });
    }

    return windows;
  }

  /**
   * Process all WFA windows for a pipeline
   */
  private async processAllWfaWindows(
    pipelineId: string,
    symbol: string,
    interval: string,
  ): Promise<void> {
    // Get all pending WFA results
    const wfaResults = await this.prismaService.walkForwardResult.findMany({
      where: {
        candidate: { pipelineId },
        status: WalkForwardStatus.PENDING,
      },
      include: {
        candidate: {
          include: {
            result: true,
          },
        },
      },
    });

    for (const wfaResult of wfaResults) {
      await this.processWfaWindow(wfaResult.id, symbol, interval);
    }

    // After all windows are processed, aggregate results
    const candidates = await this.prismaService.validationCandidate.findMany({
      where: {
        pipelineId,
        status: ValidationCandidateStatus.WFA_PENDING,
      },
    });

    const pipeline = await this.prismaService.validationPipeline.findUnique({
      where: { id: pipelineId },
    });

    for (const candidate of candidates) {
      await this.aggregateWfaResults(candidate.id, pipeline!.wfaMinConsistency);
    }
  }

  /**
   * Process a single WFA window
   */
  async processWfaWindow(
    wfaResultId: string,
    symbol: string,
    interval: string,
  ): Promise<void> {
    const wfaResult = await this.prismaService.walkForwardResult.findUnique({
      where: { id: wfaResultId },
      include: {
        candidate: {
          include: {
            result: true,
          },
        },
      },
    });

    if (!wfaResult) {
      throw new Error(`WFA result ${wfaResultId} not found`);
    }

    // Mark as processing
    await this.prismaService.walkForwardResult.update({
      where: { id: wfaResultId },
      data: { status: WalkForwardStatus.PROCESSING },
    });

    try {
      const strategyConfig = wfaResult.candidate.result
        .strategyConfig as unknown as StrategyConfig;

      // Run backtest on train period
      const trainMetrics = await this.runBacktest(
        strategyConfig,
        symbol,
        interval,
        wfaResult.trainStart,
        wfaResult.trainEnd,
      );

      // Run backtest on test period
      const testMetrics = await this.runBacktest(
        strategyConfig,
        symbol,
        interval,
        wfaResult.testStart,
        wfaResult.testEnd,
      );

      // Calculate consistency and degradation
      const { consistency, degradation } = this.calculateConsistency(
        trainMetrics,
        testMetrics,
      );

      // Update WFA result
      await this.prismaService.walkForwardResult.update({
        where: { id: wfaResultId },
        data: {
          status: WalkForwardStatus.DONE,
          trainMetrics: trainMetrics as object,
          testMetrics: testMetrics as object,
          consistency,
          degradation,
        },
      });
    } catch (error) {
      await this.prismaService.walkForwardResult.update({
        where: { id: wfaResultId },
        data: {
          status: WalkForwardStatus.FAILED,
          errorMessage: getReadableError(error),
        },
      });

      await this.logger.log({
        severity: 'Error',
        summary: `WFA window ${wfaResultId} failed`,
        details: getReadableError(error),
      });
    }
  }

  /**
   * Run a backtest for a specific period
   */
  private async runBacktest(
    config: StrategyConfig,
    symbol: string,
    interval: string,
    startDate: Date,
    endDate: Date,
  ): Promise<BacktestMetrics> {
    const strategy = ComposableStrategy.fromConfig(config);

    const engine = new ComposableBacktestEngine(strategy, {
      symbol,
      initialCapital: config.settings.initialCapital,
    });

    const candleStream = streamPriceData(symbol, interval, startDate, endDate);
    const result = await engine.runStream(candleStream);
    const extendedMetrics =
      ComposableBacktestEngine.calculateExtendedMetrics(result);

    return {
      totalTrades: result.totalTrades,
      winRate: result.winRate,
      totalPnlPercent: result.totalPnlPercent,
      maxDrawdownPercent: result.maxDrawdownPercent,
      sharpeRatio: extendedMetrics.sharpeRatio,
      profitFactor: extendedMetrics.profitFactor,
    };
  }

  /**
   * Calculate consistency score between train and test periods
   */
  private calculateConsistency(
    trainMetrics: BacktestMetrics,
    testMetrics: BacktestMetrics,
  ): { consistency: number; degradation: number } {
    // Calculate degradation (how much worse test is compared to train)
    const pnlDegradation =
      trainMetrics.totalPnlPercent !== 0
        ? (trainMetrics.totalPnlPercent - testMetrics.totalPnlPercent) /
          Math.abs(trainMetrics.totalPnlPercent)
        : 0;

    const winRateDegradation =
      trainMetrics.winRate !== 0
        ? (trainMetrics.winRate - testMetrics.winRate) / trainMetrics.winRate
        : 0;

    // Sharpe ratio degradation (handle nulls)
    let sharpeDegradation = 0;
    if (trainMetrics.sharpeRatio != null && testMetrics.sharpeRatio != null) {
      sharpeDegradation =
        trainMetrics.sharpeRatio !== 0
          ? (trainMetrics.sharpeRatio - testMetrics.sharpeRatio) /
            Math.abs(trainMetrics.sharpeRatio)
          : 0;
    }

    // Overall degradation (weighted average)
    const degradation =
      pnlDegradation * 0.4 + winRateDegradation * 0.3 + sharpeDegradation * 0.3;

    // Consistency is inverse of degradation (clamped to 0-1)
    // Lower degradation = higher consistency
    const consistency = Math.max(0, Math.min(1, 1 - Math.abs(degradation)));

    return { consistency, degradation };
  }

  /**
   * Aggregate WFA results for a candidate and determine pass/fail
   */
  async aggregateWfaResults(
    candidateId: string,
    minConsistency: number,
  ): Promise<void> {
    const wfaResults = await this.prismaService.walkForwardResult.findMany({
      where: { candidateId },
    });

    // Check if all windows completed
    const completedResults = wfaResults.filter(
      (r) => r.status === WalkForwardStatus.DONE,
    );
    const failedResults = wfaResults.filter(
      (r) => r.status === WalkForwardStatus.FAILED,
    );

    // If any window failed, mark candidate as WFA_FAILED
    if (failedResults.length > 0) {
      await this.prismaService.validationCandidate.update({
        where: { id: candidateId },
        data: {
          status: ValidationCandidateStatus.WFA_FAILED,
          wfaPassed: false,
          wfaConsistency: null,
        },
      });
      return;
    }

    // Calculate overall consistency (average of all windows)
    const consistencies = completedResults
      .map((r) => r.consistency)
      .filter((c): c is number => c != null);

    if (consistencies.length === 0) {
      await this.prismaService.validationCandidate.update({
        where: { id: candidateId },
        data: {
          status: ValidationCandidateStatus.WFA_FAILED,
          wfaPassed: false,
          wfaConsistency: null,
        },
      });
      return;
    }

    const avgConsistency =
      consistencies.reduce((a, b) => a + b, 0) / consistencies.length;
    const passed = avgConsistency >= minConsistency;

    const newStatus = passed
      ? ValidationCandidateStatus.WFA_PASSED
      : ValidationCandidateStatus.WFA_FAILED;

    await this.prismaService.validationCandidate.update({
      where: { id: candidateId },
      data: {
        status: newStatus,
        wfaPassed: passed,
        wfaConsistency: avgConsistency,
      },
    });

    await this.logger.log({
      severity: 'Info',
      summary: `WFA completed for candidate ${candidateId}`,
      details: `Consistency: ${(avgConsistency * 100).toFixed(1)}%, Passed: ${passed}`,
    });
  }
}
