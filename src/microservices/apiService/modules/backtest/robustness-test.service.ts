import { Injectable, Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  ValidationCandidateStatus,
  RobustnessTestStatus,
} from 'generated/prisma/client';

import { PrismaService } from 'src/global/prisma.service';
import { LogsService } from 'src/global/logs.service';
import { SERVICE_NAMES } from 'src/utils/constants';

import { ComposableStrategy } from 'src/backtest/core/strategy-composer';
import { ComposableBacktestEngine } from 'src/backtest/composable-backtest-engine';
import { streamPriceData } from 'src/backtest/binance-fetcher';
import { StrategyConfig } from 'src/backtest/core/interfaces';
import { getReadableError } from 'src/utils';

interface RobustnessStep {
  stepIndex: number;
  startDate: Date;
  endDate: Date;
}

@Injectable()
export class RobustnessTestService {
  constructor(
    @Inject(SERVICE_NAMES.REDIS_SERVICE) private redisClient: ClientProxy,
    private readonly prismaService: PrismaService,
    private readonly logger: LogsService,
  ) {}

  /**
   * Run robustness tests on all USER_SELECTED candidates
   */
  async runRobustnessTests(pipelineId: string): Promise<void> {
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

    // Get all USER_SELECTED candidates
    const candidates = await this.prismaService.validationCandidate.findMany({
      where: {
        pipelineId,
        status: ValidationCandidateStatus.USER_SELECTED,
      },
      include: {
        result: true,
      },
    });

    if (candidates.length === 0) {
      await this.logger.log({
        severity: 'Info',
        summary: `No user-selected candidates for pipeline ${pipelineId}`,
      });
      return;
    }

    await this.logger.log({
      severity: 'Info',
      summary: `Running robustness tests for pipeline ${pipelineId}`,
      details: `Processing ${candidates.length} candidates with ${pipeline.robustnessSteps} steps`,
    });

    const task = pipeline.templateSearch.task;
    if (!task) {
      throw new Error('Pipeline has no associated backtest task');
    }

    // Create robustness test steps for each candidate
    for (const candidate of candidates) {
      // Mark candidate as ROBUSTNESS_PENDING
      await this.prismaService.validationCandidate.update({
        where: { id: candidate.id },
        data: { status: ValidationCandidateStatus.ROBUSTNESS_PENDING },
      });

      const steps = this.createRobustnessSteps(
        task.startDate,
        task.endDate,
        pipeline.robustnessSteps,
      );

      // Create RobustnessTest records
      for (const step of steps) {
        await this.prismaService.robustnessTest.create({
          data: {
            candidateId: candidate.id,
            stepIndex: step.stepIndex,
            status: RobustnessTestStatus.PENDING,
            startDate: step.startDate,
            endDate: step.endDate,
          },
        });
      }
    }

    // Process robustness tests
    await this.processAllRobustnessTests(
      pipelineId,
      task.symbol,
      task.interval,
    );
  }

  /**
   * Generate robustness test steps (Entry Point Robustness Test)
   * Each step tests a window of EQUAL duration with shifted start points.
   * This ensures fair comparison across all robustness tests.
   *
   * Window duration is 80% of total period to allow meaningful shifts.
   * Steps are evenly distributed across the remaining 20% shift range.
   */
  private createRobustnessSteps(
    startDate: Date,
    endDate: Date,
    numSteps: number,
  ): RobustnessStep[] {
    const totalMs = endDate.getTime() - startDate.getTime();

    // Use 80% of total period as window duration for each step
    // This leaves 20% as the shift range
    const windowDuration = totalMs * 0.8;
    const shiftRange = totalMs - windowDuration; // 20% of total
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

  /**
   * Process all robustness tests for a pipeline
   */
  private async processAllRobustnessTests(
    pipelineId: string,
    symbol: string,
    interval: string,
  ): Promise<void> {
    // Get all pending robustness tests
    const tests = await this.prismaService.robustnessTest.findMany({
      where: {
        candidate: { pipelineId },
        status: RobustnessTestStatus.PENDING,
      },
      include: {
        candidate: {
          include: {
            result: true,
          },
        },
      },
    });

    for (const test of tests) {
      await this.processRobustnessStep(test.id, symbol, interval);
    }

    // After all tests are processed, aggregate results
    const candidates = await this.prismaService.validationCandidate.findMany({
      where: {
        pipelineId,
        status: ValidationCandidateStatus.ROBUSTNESS_PENDING,
      },
    });

    const pipeline = await this.prismaService.validationPipeline.findUnique({
      where: { id: pipelineId },
    });

    for (const candidate of candidates) {
      await this.aggregateRobustnessResults(
        candidate.id,
        pipeline!.robustnessMinScore,
      );
    }
  }

  /**
   * Process a single robustness test step
   */
  async processRobustnessStep(
    testId: string,
    symbol: string,
    interval: string,
  ): Promise<void> {
    const test = await this.prismaService.robustnessTest.findUnique({
      where: { id: testId },
      include: {
        candidate: {
          include: {
            result: true,
          },
        },
      },
    });

    if (!test) {
      throw new Error(`Robustness test ${testId} not found`);
    }

    // Mark as processing
    await this.prismaService.robustnessTest.update({
      where: { id: testId },
      data: { status: RobustnessTestStatus.PROCESSING },
    });

    try {
      const strategyConfig = test.candidate.result
        .strategyConfig as unknown as StrategyConfig;

      // Run backtest with shifted start date
      const strategy = ComposableStrategy.fromConfig(strategyConfig);

      const engine = new ComposableBacktestEngine(strategy, {
        symbol,
        initialCapital: strategyConfig.settings.initialCapital,
      });

      const candleStream = streamPriceData(
        symbol,
        interval,
        test.startDate,
        test.endDate,
      );
      const result = await engine.runStream(candleStream);
      const extendedMetrics =
        ComposableBacktestEngine.calculateExtendedMetrics(result);

      // Update test result
      await this.prismaService.robustnessTest.update({
        where: { id: testId },
        data: {
          status: RobustnessTestStatus.DONE,
          metrics: {
            totalTrades: result.totalTrades,
            winRate: result.winRate,
            totalPnlPercent: result.totalPnlPercent,
            maxDrawdownPercent: result.maxDrawdownPercent,
          },
          sharpeRatio: extendedMetrics.sharpeRatio,
          totalPnl: result.totalPnlPercent,
          maxDrawdown: result.maxDrawdownPercent,
        },
      });
    } catch (error) {
      await this.prismaService.robustnessTest.update({
        where: { id: testId },
        data: {
          status: RobustnessTestStatus.FAILED,
          errorMessage: getReadableError(error),
        },
      });

      await this.logger.log({
        severity: 'Error',
        summary: `Robustness test ${testId} failed`,
        details: getReadableError(error),
      });
    }
  }

  /**
   * Calculate coefficient of variation
   */
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

  /**
   * Calculate stability score from robustness tests
   */
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

    // Calculate coefficient of variation (lower = more stable)
    const sharpeCV = this.coefficientOfVariation(sharpeValues);
    const pnlCV = this.coefficientOfVariation(pnlValues);

    // Count positive results
    const positiveRatio =
      sharpeValues.filter((v) => v > 0).length / sharpeValues.length;

    // Stability score: combination of low CV and high positive ratio
    // CV is capped at 1 for scoring purposes
    const stabilityScore =
      (1 - Math.min(sharpeCV, 1)) * 0.4 +
      (1 - Math.min(pnlCV, 1)) * 0.3 +
      positiveRatio * 0.3;

    return stabilityScore;
  }

  /**
   * Aggregate robustness test results for a candidate
   */
  async aggregateRobustnessResults(
    candidateId: string,
    minScore: number,
  ): Promise<void> {
    const tests = await this.prismaService.robustnessTest.findMany({
      where: { candidateId },
    });

    // Check if all tests completed
    const completedTests = tests.filter(
      (t) => t.status === RobustnessTestStatus.DONE,
    );
    const failedTests = tests.filter(
      (t) => t.status === RobustnessTestStatus.FAILED,
    );

    // If too many tests failed, mark candidate as ROBUSTNESS_FAILED
    if (failedTests.length > tests.length * 0.3) {
      // Allow up to 30% failure
      await this.prismaService.validationCandidate.update({
        where: { id: candidateId },
        data: {
          status: ValidationCandidateStatus.ROBUSTNESS_FAILED,
          robustnessPassed: false,
          robustnessScore: null,
        },
      });
      return;
    }

    // Calculate stability score from completed tests
    const stabilityScore = this.calculateStabilityScore(completedTests);
    const passed = stabilityScore >= minScore;

    const newStatus = passed
      ? ValidationCandidateStatus.ROBUSTNESS_PASSED
      : ValidationCandidateStatus.ROBUSTNESS_FAILED;

    await this.prismaService.validationCandidate.update({
      where: { id: candidateId },
      data: {
        status: newStatus,
        robustnessPassed: passed,
        robustnessScore: stabilityScore,
      },
    });

    await this.logger.log({
      severity: 'Info',
      summary: `Robustness tests completed for candidate ${candidateId}`,
      details: `Stability score: ${(stabilityScore * 100).toFixed(1)}%, Passed: ${passed}`,
    });
  }
}
