import { Injectable, Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { ValidationCandidateStatus } from 'generated/prisma/client';
import { firstValueFrom } from 'rxjs';

import { PrismaService } from 'src/global/prisma.service';
import { LogsService } from 'src/global/logs.service';
import { PATTERNS, SERVICE_NAMES } from 'src/utils/constants';

import { ThresholdPreviewResult } from './entities';

@Injectable()
export class ThresholdFilterService {
  constructor(
    @Inject(SERVICE_NAMES.REDIS_SERVICE) private redisClient: ClientProxy,
    private readonly prismaService: PrismaService,
    private readonly logger: LogsService,
  ) {}

  /**
   * Apply a single threshold filter to all currently surviving candidates.
   * Candidates in PENDING or ACTIVE status that fail are marked THRESHOLD_ELIMINATED.
   */
  async applySingleThreshold(
    pipelineId: string,
    metricName: string,
    operator: string,
    value: number,
  ): Promise<{ candidatesBefore: number; candidatesAfter: number }> {
    const candidates = await this.prismaService.validationCandidate.findMany({
      where: {
        pipelineId,
        status: {
          in: [
            ValidationCandidateStatus.PENDING,
            ValidationCandidateStatus.ACTIVE,
          ],
        },
      },
      include: { result: true },
    });

    const candidatesBefore = candidates.length;
    let eliminatedCount = 0;

    for (const candidate of candidates) {
      if (!candidate.result) continue;

      const metricValue = this.getMetricValue(candidate.result, metricName);
      const passed = this.evaluateMetric(metricValue, operator, value);

      if (!passed) {
        await this.prismaService.validationCandidate.update({
          where: { id: candidate.id },
          data: {
            status: ValidationCandidateStatus.THRESHOLD_ELIMINATED,
            thresholdPassed: false,
          },
        });
        eliminatedCount++;

        await firstValueFrom(
          this.redisClient.emit(PATTERNS.Validation.CandidateUpdated, {
            id: candidate.id,
            pipelineId,
            status: ValidationCandidateStatus.THRESHOLD_ELIMINATED,
          }),
        );
      } else if (candidate.status === ValidationCandidateStatus.PENDING) {
        await this.prismaService.validationCandidate.update({
          where: { id: candidate.id },
          data: {
            status: ValidationCandidateStatus.ACTIVE,
            thresholdPassed: true,
          },
        });
      }
    }

    const candidatesAfter = candidatesBefore - eliminatedCount;

    await this.logger.log({
      severity: 'Info',
      summary: `Threshold applied: ${metricName} ${operator} ${value}`,
      details: `Before: ${candidatesBefore}, After: ${candidatesAfter}, Eliminated: ${eliminatedCount}`,
    });

    return { candidatesBefore, candidatesAfter };
  }

  /**
   * Preview a threshold filter without applying it.
   */
  async previewSingleThreshold(
    pipelineId: string,
    metricName: string,
    operator: string,
    value: number,
  ): Promise<ThresholdPreviewResult> {
    const candidates = await this.prismaService.validationCandidate.findMany({
      where: {
        pipelineId,
        status: {
          in: [
            ValidationCandidateStatus.PENDING,
            ValidationCandidateStatus.ACTIVE,
          ],
        },
      },
      include: { result: true },
    });

    const currentCount = candidates.length;
    let survivingCount = 0;

    for (const candidate of candidates) {
      if (!candidate.result) continue;
      const metricValue = this.getMetricValue(candidate.result, metricName);
      if (this.evaluateMetric(metricValue, operator, value)) {
        survivingCount++;
      }
    }

    return {
      currentCount,
      survivingCount,
      eliminatedCount: currentCount - survivingCount,
    };
  }

  /**
   * Recalculate all thresholds from scratch.
   * Resets all threshold-related candidates back to PENDING, then re-applies each step.
   */
  async recalculateThresholds(pipelineId: string): Promise<void> {
    await this.prismaService.validationCandidate.updateMany({
      where: {
        pipelineId,
        status: {
          in: [
            ValidationCandidateStatus.PENDING,
            ValidationCandidateStatus.ACTIVE,
            ValidationCandidateStatus.THRESHOLD_ELIMINATED,
          ],
        },
      },
      data: {
        status: ValidationCandidateStatus.PENDING,
        thresholdPassed: null,
      },
    });

    const steps = await this.prismaService.thresholdStep.findMany({
      where: { pipelineId },
      orderBy: { stepOrder: 'asc' },
    });

    for (const step of steps) {
      const result = await this.applySingleThreshold(
        pipelineId,
        step.metricName,
        step.operator,
        step.value,
      );

      await this.prismaService.thresholdStep.update({
        where: { id: step.id },
        data: {
          candidatesBefore: result.candidatesBefore,
          candidatesAfter: result.candidatesAfter,
        },
      });
    }
  }

  private getMetricValue(
    result: {
      sharpeRatio: number | null;
      winRate: number;
      profitFactor: number | null;
      maxDrawdownPercent: number;
      totalTrades: number;
      totalPnlPercent: number;
    },
    metricName: string,
  ): number | null {
    switch (metricName) {
      case 'sharpeRatio':
        return result.sharpeRatio;
      case 'winRate':
        return result.winRate;
      case 'profitFactor':
        return result.profitFactor;
      case 'maxDrawdownPercent':
        return result.maxDrawdownPercent;
      case 'totalTrades':
        return result.totalTrades;
      case 'totalPnlPercent':
        return result.totalPnlPercent;
      default:
        return null;
    }
  }

  private evaluateMetric(
    metricValue: number | null,
    operator: string,
    threshold: number,
  ): boolean {
    if (metricValue === null) return false;
    switch (operator) {
      case 'gte':
        return metricValue >= threshold;
      case 'lte':
        return metricValue <= threshold;
      default:
        return false;
    }
  }
}
