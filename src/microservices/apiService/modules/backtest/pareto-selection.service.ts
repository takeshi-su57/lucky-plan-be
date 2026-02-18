import { Injectable, Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { ValidationCandidateStatus } from 'generated/prisma/client';
import { firstValueFrom } from 'rxjs';

import { PrismaService } from 'src/global/prisma.service';
import { LogsService } from 'src/global/logs.service';
import { PATTERNS, SERVICE_NAMES } from 'src/utils/constants';

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
   * Run Pareto selection on all PASSED_THRESHOLD candidates
   */
  async runParetoSelection(pipelineId: string): Promise<void> {
    const pipeline = await this.prismaService.validationPipeline.findUnique({
      where: { id: pipelineId },
    });

    if (!pipeline) {
      throw new Error(`Pipeline ${pipelineId} not found`);
    }

    const paretoMetrics = pipeline.paretoMetrics;

    // Get all PASSED_THRESHOLD candidates with their results
    const candidates = await this.prismaService.validationCandidate.findMany({
      where: {
        pipelineId,
        status: ValidationCandidateStatus.PASSED_THRESHOLD,
      },
      include: {
        result: true,
      },
    });

    if (candidates.length === 0) {
      await this.logger.log({
        severity: 'Info',
        summary: `No candidates passed threshold filter for pipeline ${pipelineId}`,
      });
      return;
    }

    await this.logger.log({
      severity: 'Info',
      summary: `Running Pareto selection for pipeline ${pipelineId}`,
      details: `Processing ${candidates.length} candidates with metrics: ${paretoMetrics.join(', ')}`,
    });

    // Build candidate metrics array
    const candidateMetrics: CandidateWithMetrics[] = candidates.map((c) => ({
      id: c.id,
      resultId: c.resultId,
      sharpeRatio: c.result.sharpeRatio,
      totalPnlPercent: c.result.totalPnlPercent,
      maxDrawdownPercent: c.result.maxDrawdownPercent,
      winRate: c.result.winRate,
      profitFactor: c.result.profitFactor,
    }));

    // Compute Pareto front
    const rankedCandidates = this.computeParetoFront(
      candidateMetrics,
      paretoMetrics,
    );

    let paretoOptimalCount = 0;
    let dominatedCount = 0;

    // Update candidates with Pareto results
    for (const candidate of rankedCandidates) {
      const isParetoOptimal = candidate.paretoRank === 0;
      const newStatus = isParetoOptimal
        ? ValidationCandidateStatus.PARETO_OPTIMAL
        : ValidationCandidateStatus.PARETO_DOMINATED;

      await this.prismaService.validationCandidate.update({
        where: { id: candidate.id },
        data: {
          status: newStatus,
          paretoRank: candidate.paretoRank,
          dominatedBy: candidate.dominatedBy || [],
        },
      });

      if (isParetoOptimal) {
        paretoOptimalCount++;
      } else {
        dominatedCount++;
      }

      // Emit update for real-time tracking
      await firstValueFrom(
        this.redisClient.emit(PATTERNS.Validation.CandidateUpdated, {
          id: candidate.id,
          pipelineId,
          status: newStatus,
          paretoRank: candidate.paretoRank,
        }),
      );
    }

    await this.logger.log({
      severity: 'Info',
      summary: `Pareto selection completed for pipeline ${pipelineId}`,
      details: `Pareto optimal: ${paretoOptimalCount}, Dominated: ${dominatedCount}`,
    });
  }

  /**
   * Compute Pareto front using non-dominated sorting (NSGA-II style)
   * Assigns proper Pareto ranks: 0 = Pareto front, 1 = second front, etc.
   */
  private computeParetoFront(
    candidates: CandidateWithMetrics[],
    metrics: string[],
  ): CandidateWithMetrics[] {
    // Initialize all candidates
    for (const candidate of candidates) {
      candidate.paretoRank = -1; // Unassigned
      candidate.dominatedBy = [];
    }

    // Build domination relationships
    const dominationCount = new Map<string, number>(); // How many dominate this candidate
    const dominates = new Map<string, string[]>(); // Who this candidate dominates

    for (const candidate of candidates) {
      dominationCount.set(candidate.id, 0);
      dominates.set(candidate.id, []);
    }

    // Compare all pairs
    for (let i = 0; i < candidates.length; i++) {
      for (let j = i + 1; j < candidates.length; j++) {
        const a = candidates[i];
        const b = candidates[j];

        if (this.dominates(a, b, metrics)) {
          // a dominates b
          dominates.get(a.id)!.push(b.id);
          dominationCount.set(b.id, dominationCount.get(b.id)! + 1);
          b.dominatedBy!.push(a.id);
        } else if (this.dominates(b, a, metrics)) {
          // b dominates a
          dominates.get(b.id)!.push(a.id);
          dominationCount.set(a.id, dominationCount.get(a.id)! + 1);
          a.dominatedBy!.push(b.id);
        }
        // If neither dominates, they are non-dominated with respect to each other
      }
    }

    // Assign Pareto ranks using fronts
    const candidateMap = new Map(candidates.map((c) => [c.id, c]));
    let currentRank = 0;
    let remaining = new Set(candidates.map((c) => c.id));

    while (remaining.size > 0) {
      // Find all non-dominated candidates in current set
      const currentFront: string[] = [];

      for (const id of remaining) {
        // Count how many dominators are still in the remaining set
        const candidate = candidateMap.get(id)!;
        const activeDominators = candidate.dominatedBy!.filter((d) =>
          remaining.has(d),
        );

        if (activeDominators.length === 0) {
          currentFront.push(id);
        }
      }

      // Assign rank to current front
      for (const id of currentFront) {
        candidateMap.get(id)!.paretoRank = currentRank;
        remaining.delete(id);
      }

      currentRank++;

      // Safety check to prevent infinite loop
      if (currentFront.length === 0 && remaining.size > 0) {
        // This shouldn't happen, but assign remaining to current rank
        for (const id of remaining) {
          candidateMap.get(id)!.paretoRank = currentRank;
        }
        break;
      }
    }

    return candidates;
  }

  /**
   * Check if candidate A dominates candidate B
   * A dominates B if A is >= B in all metrics and > B in at least one
   * Note: maxDrawdownPercent is inverted (lower is better)
   */
  private dominates(
    a: CandidateWithMetrics,
    b: CandidateWithMetrics,
    metrics: string[],
  ): boolean {
    let betterInOne = false;

    for (const metric of metrics) {
      const aVal = this.getMetricValue(a, metric);
      const bVal = this.getMetricValue(b, metric);

      // Handle null values - null is treated as worst
      if (aVal === null && bVal === null) continue;
      if (aVal === null) return false; // A can't dominate if A has null
      if (bVal === null) {
        betterInOne = true;
        continue;
      }

      // maxDrawdownPercent is a minimization metric (lower is better)
      const isMaximize = metric !== 'maxDrawdownPercent';

      if (isMaximize) {
        if (aVal < bVal) return false; // A is worse, can't dominate
        if (aVal > bVal) betterInOne = true; // A is better in this metric
      } else {
        // Minimization: lower is better
        if (aVal > bVal) return false; // A is worse, can't dominate
        if (aVal < bVal) betterInOne = true; // A is better in this metric
      }
    }

    return betterInOne;
  }

  /**
   * Get metric value from candidate
   */
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
