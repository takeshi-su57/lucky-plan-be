import { Injectable, Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { ValidationCandidateStatus } from 'generated/prisma/client';

import { PrismaService } from 'src/global/prisma.service';
import { LogsService } from 'src/global/logs.service';
import { SERVICE_NAMES } from 'src/utils/constants';

import { ComposableStrategy } from 'src/backtest/core/strategy-composer';
import { ComposableBacktestEngine } from 'src/backtest/composable-backtest-engine';
import { streamPriceData } from 'src/backtest/binance-fetcher';
import { StrategyConfig } from 'src/backtest/core/interfaces';
import { getReadableError } from 'src/utils';

import { RobustnessStepResult } from './entities';

interface RobustnessStep {
  stepIndex: number;
  startDate: Date;
  endDate: Date;
}

interface RobustnessConfig {
  steps: number;
  minScore: number;
}

@Injectable()
export class RobustnessTestService {
  constructor(
    @Inject(SERVICE_NAMES.REDIS_SERVICE) private redisClient: ClientProxy,
    private readonly prismaService: PrismaService,
    private readonly logger: LogsService,
  ) {}

  /**
   * Run a single robustness step across all USER_SELECTED candidates.
   * Results are appended to each candidate's robustnessStepResults JSON.
   */
  async runSingleStep(
    pipelineId: string,
    stepIndex: number,
    config: RobustnessConfig,
  ): Promise<RobustnessStepResult[]> {
    const pipeline = await this.prismaService.validationPipeline.findUnique({
      where: { id: pipelineId },
      include: { backtestTask: true },
    });

    if (!pipeline || !pipeline.backtestTask) {
      throw new Error(`Pipeline ${pipelineId} or its task not found`);
    }

    const task = pipeline.backtestTask;

    const candidates = await this.prismaService.validationCandidate.findMany({
      where: {
        pipelineId,
        status: ValidationCandidateStatus.USER_SELECTED,
      },
      include: { result: true },
    });

    if (candidates.length === 0) {
      return [];
    }

    const steps = this.createRobustnessSteps(
      task.startDate,
      task.endDate,
      config.steps,
    );

    const step = steps[stepIndex];
    if (!step) {
      throw new Error(`Step index ${stepIndex} out of range`);
    }

    await this.logger.log({
      severity: 'Info',
      summary: `Running robustness step ${stepIndex} for pipeline ${pipelineId}`,
      details: `Processing ${candidates.length} candidates`,
    });

    const results: RobustnessStepResult[] = [];

    for (const candidate of candidates) {
      try {
        const strategyConfig = candidate.result
          .strategyConfig as unknown as StrategyConfig;

        const strategy = ComposableStrategy.fromConfig(strategyConfig);
        const engine = new ComposableBacktestEngine(strategy, {
          symbol: task.symbol,
          initialCapital: strategyConfig.settings.initialCapital,
        });

        const candleStream = streamPriceData(
          task.symbol,
          task.interval,
          step.startDate,
          step.endDate,
        );
        const result = await engine.runStream(candleStream);
        const extendedMetrics =
          ComposableBacktestEngine.calculateExtendedMetrics(result);

        const stepResult = {
          stepIndex,
          sharpeRatio: extendedMetrics.sharpeRatio,
          totalPnl: result.totalPnlPercent,
          maxDrawdown: result.maxDrawdownPercent,
          status: 'DONE',
        };

        const existingResults =
          (candidate.robustnessStepResults as unknown as unknown[]) || [];
        existingResults.push(stepResult);

        await this.prismaService.validationCandidate.update({
          where: { id: candidate.id },
          data: { robustnessStepResults: existingResults as object },
        });

        results.push({
          candidateId: candidate.id,
          configId: candidate.configId,
          stepIndex,
          sharpeRatio: extendedMetrics.sharpeRatio,
          totalPnl: result.totalPnlPercent,
          maxDrawdown: result.maxDrawdownPercent,
          status: 'DONE',
        });
      } catch (error) {
        const stepResult = {
          stepIndex,
          sharpeRatio: null,
          totalPnl: null,
          maxDrawdown: null,
          status: 'FAILED',
          errorMessage: getReadableError(error),
        };

        const existingResults =
          (candidate.robustnessStepResults as unknown as unknown[]) || [];
        existingResults.push(stepResult);

        await this.prismaService.validationCandidate.update({
          where: { id: candidate.id },
          data: { robustnessStepResults: existingResults as object },
        });

        results.push({
          candidateId: candidate.id,
          configId: candidate.configId,
          stepIndex,
          sharpeRatio: null,
          totalPnl: null,
          maxDrawdown: null,
          status: 'FAILED',
          errorMessage: getReadableError(error),
        });

        await this.logger.log({
          severity: 'Error',
          summary: `Robustness step ${stepIndex} failed for candidate ${candidate.id}`,
          details: getReadableError(error),
        });
      }
    }

    return results;
  }

  /**
   * Aggregate robustness results for all USER_SELECTED candidates.
   */
  async aggregateAllCandidates(
    pipelineId: string,
    minScore: number,
  ): Promise<void> {
    const candidates = await this.prismaService.validationCandidate.findMany({
      where: {
        pipelineId,
        status: ValidationCandidateStatus.USER_SELECTED,
      },
    });

    for (const candidate of candidates) {
      const stepResults =
        (candidate.robustnessStepResults as unknown as {
          sharpeRatio: number | null;
          totalPnl: number | null;
          status: string;
        }[]) || [];

      const completedTests = stepResults.filter((t) => t.status === 'DONE');
      const failedTests = stepResults.filter((t) => t.status === 'FAILED');

      if (failedTests.length > stepResults.length * 0.3) {
        await this.prismaService.validationCandidate.update({
          where: { id: candidate.id },
          data: {
            status: ValidationCandidateStatus.ROBUSTNESS_FAILED,
            robustnessPassed: false,
            robustnessScore: null,
          },
        });
        continue;
      }

      const stabilityScore = this.calculateStabilityScore(completedTests);
      const passed = stabilityScore >= minScore;

      await this.prismaService.validationCandidate.update({
        where: { id: candidate.id },
        data: {
          status: passed
            ? ValidationCandidateStatus.ROBUSTNESS_PASSED
            : ValidationCandidateStatus.ROBUSTNESS_FAILED,
          robustnessPassed: passed,
          robustnessScore: stabilityScore,
        },
      });

      await this.logger.log({
        severity: 'Info',
        summary: `Robustness completed for candidate ${candidate.id}`,
        details: `Stability: ${(stabilityScore * 100).toFixed(1)}%, Passed: ${passed}`,
      });
    }
  }

  private createRobustnessSteps(
    startDate: Date,
    endDate: Date,
    numSteps: number,
  ): RobustnessStep[] {
    const totalMs = endDate.getTime() - startDate.getTime();
    const windowDuration = totalMs * 0.8;
    const shiftRange = totalMs - windowDuration;
    const shiftStep = numSteps > 1 ? shiftRange / (numSteps - 1) : 0;

    const steps: RobustnessStep[] = [];

    for (let i = 0; i < numSteps; i++) {
      const shiftedStart = new Date(startDate.getTime() + i * shiftStep);
      const shiftedEnd = new Date(shiftedStart.getTime() + windowDuration);

      steps.push({
        stepIndex: i,
        startDate: shiftedStart,
        endDate: shiftedEnd,
      });
    }

    return steps;
  }

  private coefficientOfVariation(values: number[]): number {
    if (values.length === 0) return 1;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    if (mean === 0) return 1;
    const variance =
      values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) /
      values.length;
    const stdDev = Math.sqrt(variance);
    return stdDev / Math.abs(mean);
  }

  private calculateStabilityScore(
    tests: { sharpeRatio: number | null; totalPnl: number | null }[],
  ): number {
    const sharpeValues = tests
      .map((t) => t.sharpeRatio)
      .filter((v): v is number => v != null);
    const pnlValues = tests
      .map((t) => t.totalPnl)
      .filter((v): v is number => v != null);

    if (sharpeValues.length === 0 || pnlValues.length === 0) {
      return 0;
    }

    const sharpeCV = this.coefficientOfVariation(sharpeValues);
    const pnlCV = this.coefficientOfVariation(pnlValues);
    const positiveRatio =
      sharpeValues.filter((v) => v > 0).length / sharpeValues.length;

    return (
      (1 - Math.min(sharpeCV, 1)) * 0.4 +
      (1 - Math.min(pnlCV, 1)) * 0.3 +
      positiveRatio * 0.3
    );
  }
}
