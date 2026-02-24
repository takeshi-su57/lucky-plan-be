import { Injectable, Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { ValidationCandidateStatus } from 'generated/prisma/client';
import { firstValueFrom } from 'rxjs';

import { PrismaService } from 'src/global/prisma.service';
import { LogsService } from 'src/global/logs.service';
import { SERVICE_NAMES, PATTERNS } from 'src/utils/constants';

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

interface WfaConfig {
  trainRatio: number;
  windows: number;
  minConsistency: number;
}

export type WfaStatus = 'IDLE' | 'RUNNING' | 'PAUSED' | 'DONE';

export interface WfaConfigWithState extends WfaConfig {
  status: WfaStatus;
  processedCandidates: number;
  totalCandidates: number;
}

@Injectable()
export class WalkForwardService {
  constructor(
    @Inject(SERVICE_NAMES.REDIS_SERVICE) private redisClient: ClientProxy,
    private readonly prismaService: PrismaService,
    private readonly logger: LogsService,
  ) {}

  /**
   * Process the next unprocessed PARETO_OPTIMAL candidate for this pipeline.
   * Each call = one "tick" (one candidate fully processed).
   * After processing, reads DB status — if still RUNNING, schedules next tick via setTimeout.
   * If status is no longer RUNNING (i.e., PAUSED), stops scheduling.
   * If no more candidates remain, sets status to DONE.
   */
  async processNextCandidate(pipelineId: string): Promise<void> {
    // 1. Read pipeline + task from DB (source of truth for status)
    const pipeline = await this.prismaService.validationPipeline.findUnique({
      where: { id: pipelineId },
      include: { backtestTask: true },
    });

    if (!pipeline || !pipeline.backtestTask) {
      await this.logger.log({
        severity: 'Error',
        summary: `WFA tick: Pipeline ${pipelineId} or its task not found`,
      });
      return;
    }

    const wfaConfig = pipeline.wfaConfig as unknown as WfaConfigWithState | null;

    // 2. Check DB status — if not RUNNING, do not proceed (pause took effect)
    if (!wfaConfig || wfaConfig.status !== 'RUNNING') {
      return;
    }

    const task = pipeline.backtestTask;
    const config: WfaConfig = {
      trainRatio: wfaConfig.trainRatio,
      windows: wfaConfig.windows,
      minConsistency: wfaConfig.minConsistency,
    };

    // 3. Find the next unprocessed candidate (PARETO_OPTIMAL = not yet processed)
    const candidate = await this.prismaService.validationCandidate.findFirst({
      where: {
        pipelineId,
        status: ValidationCandidateStatus.PARETO_OPTIMAL,
      },
      include: { result: true },
      orderBy: { createdAt: 'asc' },
    });

    // 4. If no more candidates, mark DONE
    if (!candidate) {
      await this.updateWfaState(
        pipelineId,
        config,
        'DONE',
        wfaConfig.processedCandidates,
        wfaConfig.totalCandidates,
      );
      await this.logger.log({
        severity: 'Info',
        summary: `WFA completed for pipeline ${pipelineId}`,
        details: `Processed ${wfaConfig.processedCandidates}/${wfaConfig.totalCandidates} candidates`,
      });
      return;
    }

    // 5. Process this single candidate (all windows)
    const strategyConfig = candidate.result
      .strategyConfig as unknown as StrategyConfig;

    const windows = this.createWfaWindows(
      task.startDate,
      task.endDate,
      config.trainRatio,
      config.windows,
    );

    const windowResults: Array<{
      windowIndex: number;
      consistency: number | null;
      degradation: number | null;
      status: string;
      errorMessage?: string;
    }> = [];

    let hasFailed = false;

    for (const window of windows) {
      try {
        const trainMetrics = await this.runBacktest(
          strategyConfig,
          task.symbol,
          task.interval,
          window.trainStart,
          window.trainEnd,
        );

        const testMetrics = await this.runBacktest(
          strategyConfig,
          task.symbol,
          task.interval,
          window.testStart,
          window.testEnd,
        );

        const { consistency, degradation } = this.calculateConsistency(
          trainMetrics,
          testMetrics,
        );

        windowResults.push({
          windowIndex: window.windowIndex,
          consistency,
          degradation,
          status: 'DONE',
        });
      } catch (error) {
        hasFailed = true;
        windowResults.push({
          windowIndex: window.windowIndex,
          consistency: null,
          degradation: null,
          status: 'FAILED',
          errorMessage: getReadableError(error),
        });

        await this.logger.log({
          severity: 'Error',
          summary: `WFA window ${window.windowIndex} failed for candidate ${candidate.id}`,
          details: getReadableError(error),
        });
      }
    }

    // 6. Compute consistency for this candidate
    const consistencies = windowResults
      .filter((r) => r.status === 'DONE')
      .map((r) => r.consistency)
      .filter((c): c is number => c != null);

    let passed = false;
    let avgConsistency: number | null = null;

    if (!hasFailed && consistencies.length > 0) {
      avgConsistency =
        consistencies.reduce((a, b) => a + b, 0) / consistencies.length;
      passed = avgConsistency >= config.minConsistency;
    }

    // 7. Persist candidate results
    const updatedCandidate = await this.prismaService.validationCandidate.update({
      where: { id: candidate.id },
      data: {
        wfaWindowResults: windowResults as object,
        wfaConsistency: avgConsistency,
        wfaPassed: passed,
        status: passed
          ? ValidationCandidateStatus.WFA_PASSED
          : ValidationCandidateStatus.WFA_FAILED,
      },
    });

    // 8. Emit candidate update via Redis
    await firstValueFrom(
      this.redisClient.emit(PATTERNS.Validation.CandidateUpdated, updatedCandidate),
    );

    const newProcessedCount = wfaConfig.processedCandidates + 1;

    // 9. Update pipeline progress
    await this.updateWfaState(
      pipelineId,
      config,
      'RUNNING',
      newProcessedCount,
      wfaConfig.totalCandidates,
    );

    // 10. Re-read pipeline status from DB to check if paused during processing
    const freshPipeline = await this.prismaService.validationPipeline.findUnique({
      where: { id: pipelineId },
    });
    const freshConfig = freshPipeline?.wfaConfig as unknown as WfaConfigWithState | null;

    if (freshConfig?.status !== 'RUNNING') {
      return;
    }

    // 11. Schedule next tick via setTimeout (yields to event loop)
    setTimeout(() => {
      this.processNextCandidate(pipelineId).catch(async (error) => {
        await this.logger.log({
          severity: 'Error',
          summary: `WFA tick failed for pipeline ${pipelineId}`,
          details: getReadableError(error),
        });

        try {
          await this.updateWfaState(
            pipelineId,
            config,
            'PAUSED',
            newProcessedCount,
            wfaConfig.totalCandidates,
          );
        } catch { /* best effort */ }
      });
    }, 0);
  }

  private async updateWfaState(
    pipelineId: string,
    config: WfaConfig,
    status: WfaStatus,
    processedCandidates: number,
    totalCandidates: number,
  ): Promise<void> {
    const wfaConfig: WfaConfigWithState = {
      ...config,
      status,
      processedCandidates,
      totalCandidates,
    };

    // Count passed candidates for real-time stats
    const passedWfaCount = await this.prismaService.validationCandidate.count({
      where: {
        pipelineId,
        status: ValidationCandidateStatus.WFA_PASSED,
      },
    });

    const updatedPipeline = await this.prismaService.validationPipeline.update({
      where: { id: pipelineId },
      data: {
        wfaConfig: wfaConfig as object,
        wfaCompletedWindows: processedCandidates,
        passedWfa: passedWfaCount,
      },
    });

    await firstValueFrom(
      this.redisClient.emit(PATTERNS.Validation.PipelineUpdated, updatedPipeline),
    );
  }

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

  private calculateConsistency(
    trainMetrics: BacktestMetrics,
    testMetrics: BacktestMetrics,
  ): { consistency: number; degradation: number } {
    const pnlDegradation =
      trainMetrics.totalPnlPercent !== 0
        ? (trainMetrics.totalPnlPercent - testMetrics.totalPnlPercent) /
          Math.abs(trainMetrics.totalPnlPercent)
        : 0;

    const winRateDegradation =
      trainMetrics.winRate !== 0
        ? (trainMetrics.winRate - testMetrics.winRate) / trainMetrics.winRate
        : 0;

    let sharpeDegradation = 0;
    if (trainMetrics.sharpeRatio != null && testMetrics.sharpeRatio != null) {
      sharpeDegradation =
        trainMetrics.sharpeRatio !== 0
          ? (trainMetrics.sharpeRatio - testMetrics.sharpeRatio) /
            Math.abs(trainMetrics.sharpeRatio)
          : 0;
    }

    const degradation =
      pnlDegradation * 0.4 + winRateDegradation * 0.3 + sharpeDegradation * 0.3;

    const consistency = Math.max(0, Math.min(1, 1 - Math.abs(degradation)));

    return { consistency, degradation };
  }
}
