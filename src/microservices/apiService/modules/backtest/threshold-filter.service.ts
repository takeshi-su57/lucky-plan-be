import { Injectable, Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { ValidationCandidateStatus } from 'generated/prisma/client';
import { firstValueFrom } from 'rxjs';

import { PrismaService } from 'src/global/prisma.service';
import { LogsService } from 'src/global/logs.service';
import { PATTERNS, SERVICE_NAMES } from 'src/utils/constants';

interface ThresholdConfig {
  minSharpeRatio?: number;
  maxSharpeRatio?: number;
  minWinRate?: number;
  minProfitFactor?: number;
  maxDrawdownPercent?: number;
  minTotalTrades?: number;
  minTotalPnlPercent?: number;
}

interface ThresholdDetail {
  value: number | null;
  threshold: number;
  passed: boolean;
}

interface ThresholdDetails {
  [key: string]: ThresholdDetail;
}

interface CandidateMetrics {
  sharpeRatio: number | null;
  winRate: number;
  profitFactor: number | null;
  maxDrawdownPercent: number;
  totalTrades: number;
  totalPnlPercent: number;
}

@Injectable()
export class ThresholdFilterService {
  constructor(
    @Inject(SERVICE_NAMES.REDIS_SERVICE) private redisClient: ClientProxy,
    private readonly prismaService: PrismaService,
    private readonly logger: LogsService,
  ) {}

  /**
   * Run threshold filter on all PENDING candidates for a pipeline
   */
  async runThresholdFilter(pipelineId: string): Promise<void> {
    const pipeline = await this.prismaService.validationPipeline.findUnique({
      where: { id: pipelineId },
    });

    if (!pipeline) {
      throw new Error(`Pipeline ${pipelineId} not found`);
    }

    const thresholdConfig = pipeline.thresholdConfig as ThresholdConfig;

    // Get all PENDING candidates with their results
    const candidates = await this.prismaService.validationCandidate.findMany({
      where: {
        pipelineId,
        status: ValidationCandidateStatus.PENDING,
      },
      include: {
        result: true,
      },
    });

    await this.logger.log({
      severity: 'Info',
      summary: `Running threshold filter for pipeline ${pipelineId}`,
      details: `Processing ${candidates.length} candidates`,
    });

    let passedCount = 0;
    let failedCount = 0;

    for (const candidate of candidates) {
      const metrics: CandidateMetrics = {
        sharpeRatio: candidate.result.sharpeRatio,
        winRate: candidate.result.winRate,
        profitFactor: candidate.result.profitFactor,
        maxDrawdownPercent: candidate.result.maxDrawdownPercent,
        totalTrades: candidate.result.totalTrades,
        totalPnlPercent: candidate.result.totalPnlPercent,
      };

      const { passed, details } = this.evaluateThresholds(
        metrics,
        thresholdConfig,
      );

      const newStatus = passed
        ? ValidationCandidateStatus.PASSED_THRESHOLD
        : ValidationCandidateStatus.FAILED_THRESHOLD;

      await this.prismaService.validationCandidate.update({
        where: { id: candidate.id },
        data: {
          status: newStatus,
          thresholdPassed: passed,
          thresholdDetails: details as object,
        },
      });

      if (passed) {
        passedCount++;
      } else {
        failedCount++;
      }

      // Emit update for real-time tracking
      await firstValueFrom(
        this.redisClient.emit(PATTERNS.Validation.CandidateUpdated, {
          id: candidate.id,
          pipelineId,
          status: newStatus,
        }),
      );
    }

    await this.logger.log({
      severity: 'Info',
      summary: `Threshold filter completed for pipeline ${pipelineId}`,
      details: `Passed: ${passedCount}, Failed: ${failedCount}`,
    });
  }

  /**
   * Evaluate a candidate against threshold configuration
   */
  private evaluateThresholds(
    metrics: CandidateMetrics,
    config: ThresholdConfig,
  ): { passed: boolean; details: ThresholdDetails } {
    const details: ThresholdDetails = {};
    let allPassed = true;

    // Min Sharpe Ratio
    if (config.minSharpeRatio != null) {
      const value = metrics.sharpeRatio;
      const passed = value != null && value >= config.minSharpeRatio;
      details.minSharpeRatio = {
        value,
        threshold: config.minSharpeRatio,
        passed,
      };
      allPassed = allPassed && passed;
    }

    // Max Sharpe Ratio
    if (config.maxSharpeRatio != null) {
      const value = metrics.sharpeRatio;
      const passed = value != null && value <= config.maxSharpeRatio;
      details.maxSharpeRatio = {
        value,
        threshold: config.maxSharpeRatio,
        passed,
      };
      allPassed = allPassed && passed;
    }

    // Min Win Rate
    if (config.minWinRate != null) {
      const value = metrics.winRate;
      const passed = value >= config.minWinRate;
      details.minWinRate = {
        value,
        threshold: config.minWinRate,
        passed,
      };
      allPassed = allPassed && passed;
    }

    // Min Profit Factor
    if (config.minProfitFactor != null) {
      const value = metrics.profitFactor;
      const passed = value != null && value >= config.minProfitFactor;
      details.minProfitFactor = {
        value,
        threshold: config.minProfitFactor,
        passed,
      };
      allPassed = allPassed && passed;
    }

    // Max Drawdown Percent (lower is better)
    if (config.maxDrawdownPercent != null) {
      const value = metrics.maxDrawdownPercent;
      const passed = value <= config.maxDrawdownPercent;
      details.maxDrawdownPercent = {
        value,
        threshold: config.maxDrawdownPercent,
        passed,
      };
      allPassed = allPassed && passed;
    }

    // Min Total Trades
    if (config.minTotalTrades != null) {
      const value = metrics.totalTrades;
      const passed = value >= config.minTotalTrades;
      details.minTotalTrades = {
        value,
        threshold: config.minTotalTrades,
        passed,
      };
      allPassed = allPassed && passed;
    }

    // Min Total PnL Percent
    if (config.minTotalPnlPercent != null) {
      const value = metrics.totalPnlPercent;
      const passed = value >= config.minTotalPnlPercent;
      details.minTotalPnlPercent = {
        value,
        threshold: config.minTotalPnlPercent,
        passed,
      };
      allPassed = allPassed && passed;
    }

    return { passed: allPassed, details };
  }
}
