import { Injectable, Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { ValidationCandidateStatus } from 'generated/prisma/client';
import { firstValueFrom } from 'rxjs';

import { PrismaService } from 'src/global/prisma.service';
import { LogsService } from 'src/global/logs.service';
import { PATTERNS, SERVICE_NAMES } from 'src/utils/constants';
import { ParetoPreviewResult } from './entities';

interface CandidateWithMetrics {
  id: string;
  resultId: string;
  sharpeRatio: number | null;
  totalPnlPercent: number;
  maxDrawdownPercent: number;
  winRate: number;
  profitFactor: number | null;
  paretoRank?: number;
  dominatedBy?: string[];
}

@Injectable()
export class ParetoSelectionService {
  constructor(
    @Inject(SERVICE_NAMES.REDIS_SERVICE) private redisClient: ClientProxy,
    private readonly prismaService: PrismaService,
    private readonly logger: LogsService,
  ) {}

  /**
   * Preview Pareto selection — in-memory only, no DB writes.
   */
  async previewParetoSelection(
    pipelineId: string,
    metrics: string[],
  ): Promise<ParetoPreviewResult> {
    const candidates = await this.loadActiveCandidates(pipelineId);
    const ranked = this.computeParetoFront(
      candidates.map((c) => ({ ...c })),
      metrics,
    );
    const optimalCount = ranked.filter((c) => c.paretoRank === 0).length;

    return {
      currentCount: candidates.length,
      optimalCount,
      dominatedCount: candidates.length - optimalCount,
    };
  }

  /**
   * Apply a single Pareto run. Returns the IDs of optimal candidates for this run.
   */
  async applySingleParetoRun(
    pipelineId: string,
    metrics: string[],
  ): Promise<{ candidatesBefore: number; candidatesAfter: number; optimalIds: string[] }> {
    const candidates = await this.loadActiveCandidates(pipelineId);

    if (candidates.length === 0) {
      return { candidatesBefore: 0, candidatesAfter: 0, optimalIds: [] };
    }

    const ranked = this.computeParetoFront(candidates, metrics);
    const optimalIds = ranked
      .filter((c) => c.paretoRank === 0)
      .map((c) => c.id);

    await this.logger.log({
      severity: 'Info',
      summary: `Pareto run for pipeline ${pipelineId}`,
      details: `Metrics: ${metrics.join(', ')}. Optimal: ${optimalIds.length}/${candidates.length}`,
    });

    return {
      candidatesBefore: candidates.length,
      candidatesAfter: optimalIds.length,
      optimalIds,
    };
  }

  /**
   * Recompute candidate statuses from all ParetoStep records (union model).
   * A candidate is PARETO_OPTIMAL if it appears in the optimal set of ANY step.
   */
  async recalculateFromSteps(pipelineId: string): Promise<void> {
    const steps = await this.prismaService.paretoStep.findMany({
      where: { pipelineId },
      orderBy: { stepOrder: 'asc' },
    });

    const candidates = await this.prismaService.validationCandidate.findMany({
      where: {
        pipelineId,
        status: {
          in: [
            ValidationCandidateStatus.ACTIVE,
            ValidationCandidateStatus.PARETO_OPTIMAL,
            ValidationCandidateStatus.PARETO_DOMINATED,
          ],
        },
      },
    });

    if (steps.length === 0) {
      // No steps — reset all to ACTIVE
      for (const c of candidates) {
        if (c.status !== ValidationCandidateStatus.ACTIVE) {
          await this.prismaService.validationCandidate.update({
            where: { id: c.id },
            data: {
              status: ValidationCandidateStatus.ACTIVE,
              paretoRank: null,
              dominatedBy: [],
            },
          });
        }
      }
      return;
    }

    // Union optimal sets from all steps (OR — optimal in ANY run)
    const optimalSet = new Set<string>();
    for (const step of steps) {
      for (const id of step.optimalCandidateIds) {
        optimalSet.add(id);
      }
    }

    for (const c of candidates) {
      const isOptimal = optimalSet.has(c.id);
      const newStatus = isOptimal
        ? ValidationCandidateStatus.PARETO_OPTIMAL
        : ValidationCandidateStatus.PARETO_DOMINATED;

      if (c.status !== newStatus) {
        await this.prismaService.validationCandidate.update({
          where: { id: c.id },
          data: {
            status: newStatus,
            paretoRank: isOptimal ? 0 : 1,
            dominatedBy: [],
          },
        });

        await firstValueFrom(
          this.redisClient.emit(PATTERNS.Validation.CandidateUpdated, {
            id: c.id,
            pipelineId,
            status: newStatus,
            paretoRank: isOptimal ? 0 : 1,
          }),
        );
      }
    }
  }

  // ==================== Private helpers ====================

  private async loadActiveCandidates(
    pipelineId: string,
  ): Promise<CandidateWithMetrics[]> {
    const candidates = await this.prismaService.validationCandidate.findMany({
      where: {
        pipelineId,
        status: {
          in: [
            ValidationCandidateStatus.ACTIVE,
            ValidationCandidateStatus.PARETO_OPTIMAL,
            ValidationCandidateStatus.PARETO_DOMINATED,
          ],
        },
      },
      include: { result: true },
    });

    return candidates.map((c) => ({
      id: c.id,
      resultId: c.resultId,
      sharpeRatio: c.result.sharpeRatio,
      totalPnlPercent: c.result.totalPnlPercent,
      maxDrawdownPercent: c.result.maxDrawdownPercent,
      winRate: c.result.winRate,
      profitFactor: c.result.profitFactor,
    }));
  }

  private computeParetoFront(
    candidates: CandidateWithMetrics[],
    metrics: string[],
  ): CandidateWithMetrics[] {
    for (const candidate of candidates) {
      candidate.paretoRank = -1;
      candidate.dominatedBy = [];
    }

    for (let i = 0; i < candidates.length; i++) {
      for (let j = i + 1; j < candidates.length; j++) {
        const a = candidates[i];
        const b = candidates[j];

        if (this.dominates(a, b, metrics)) {
          b.dominatedBy!.push(a.id);
        } else if (this.dominates(b, a, metrics)) {
          a.dominatedBy!.push(b.id);
        }
      }
    }

    const candidateMap = new Map(candidates.map((c) => [c.id, c]));
    let currentRank = 0;
    let remaining = new Set(candidates.map((c) => c.id));

    while (remaining.size > 0) {
      const currentFront: string[] = [];

      for (const id of remaining) {
        const candidate = candidateMap.get(id)!;
        const activeDominators = candidate.dominatedBy!.filter((d) =>
          remaining.has(d),
        );
        if (activeDominators.length === 0) {
          currentFront.push(id);
        }
      }

      for (const id of currentFront) {
        candidateMap.get(id)!.paretoRank = currentRank;
        remaining.delete(id);
      }

      currentRank++;

      if (currentFront.length === 0 && remaining.size > 0) {
        for (const id of remaining) {
          candidateMap.get(id)!.paretoRank = currentRank;
        }
        break;
      }
    }

    return candidates;
  }

  private dominates(
    a: CandidateWithMetrics,
    b: CandidateWithMetrics,
    metrics: string[],
  ): boolean {
    let betterInOne = false;

    for (const metric of metrics) {
      const aVal = this.getMetricValue(a, metric);
      const bVal = this.getMetricValue(b, metric);

      if (aVal === null && bVal === null) continue;
      if (aVal === null) return false;
      if (bVal === null) {
        betterInOne = true;
        continue;
      }

      const isMaximize = metric !== 'maxDrawdownPercent';

      if (isMaximize) {
        if (aVal < bVal) return false;
        if (aVal > bVal) betterInOne = true;
      } else {
        if (aVal > bVal) return false;
        if (aVal < bVal) betterInOne = true;
      }
    }

    return betterInOne;
  }

  private getMetricValue(
    candidate: CandidateWithMetrics,
    metric: string,
  ): number | null {
    switch (metric) {
      case 'sharpeRatio':
        return candidate.sharpeRatio;
      case 'totalPnlPercent':
        return candidate.totalPnlPercent;
      case 'maxDrawdownPercent':
        return candidate.maxDrawdownPercent;
      case 'winRate':
        return candidate.winRate;
      case 'profitFactor':
        return candidate.profitFactor;
      default:
        return null;
    }
  }
}
