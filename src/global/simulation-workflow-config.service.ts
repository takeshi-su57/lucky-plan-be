import { BadRequestException, Injectable } from '@nestjs/common';

import { PrismaService } from './prisma.service';

export const SIMULATION_WORKFLOW_CONFIG_KEY = 'simulation.workflow.config';

export type SimulationWorkflowConfig = {
  maxSimulationsPerResearch: number;
  maxOutstandingDynamicPlans: number;
  finalizerBatchSize: number;
  finalizerConcurrency: number;
  sourceDerivedRecalculationConcurrency: number;
  finalizerBotCacheConcurrency: number;
  finalizerRetryDelayMs: number;
  maxAwaitingFinalizationPlans: number;
  finalizerLeaseMs: number;
  evaluatorTaskLeaseMs: number;
  queuedTaskBatchSize: number;
  readyTaskScanLimit: number;
  eventLogAddressBatchSize: number;
  eventLogRecordBatchSize: number;
  prebuildChunkSourceRecordLimit: number;
  leaderScoringWindowDays: number;
  candidateRecentActivityDays: number;
  botTraderMinAvgDurationMs: number;
};

export const SIMULATION_WORKFLOW_DEFAULTS: SimulationWorkflowConfig = {
  maxSimulationsPerResearch: 30,
  // This is a safety ceiling above the capacity-derived queue watermarks. A
  // 48-slot fleet can retain 144 ready tasks plus its active claims.
  maxOutstandingDynamicPlans: 500,
  finalizerBatchSize: 20,
  finalizerConcurrency: 8,
  // Source-derived simulations are database-heavy Layer 2/3 recalculations.
  // Preserve the former one-at-a-time behavior until an operator raises this.
  sourceDerivedRecalculationConcurrency: 1,
  finalizerBotCacheConcurrency: 4,
  finalizerRetryDelayMs: 60_000,
  maxAwaitingFinalizationPlans: 200,
  finalizerLeaseMs: 30 * 60_000,
  evaluatorTaskLeaseMs: 90_000,
  queuedTaskBatchSize: 100,
  readyTaskScanLimit: 50,
  eventLogAddressBatchSize: 100,
  eventLogRecordBatchSize: 2_000,
  prebuildChunkSourceRecordLimit: 20_000,
  leaderScoringWindowDays: 180,
  candidateRecentActivityDays: 30,
  botTraderMinAvgDurationMs: 10 * 60_000,
};
export type SimulationWorkflowConfigInput = Partial<SimulationWorkflowConfig>;

const bounds: Record<keyof SimulationWorkflowConfig, [number, number]> = {
  maxSimulationsPerResearch: [1, 500],
  maxOutstandingDynamicPlans: [1, 500],
  finalizerBatchSize: [1, 500],
  finalizerConcurrency: [1, 100],
  sourceDerivedRecalculationConcurrency: [1, 100],
  finalizerBotCacheConcurrency: [1, 32],
  finalizerRetryDelayMs: [10_000, 24 * 60 * 60_000],
  maxAwaitingFinalizationPlans: [1, 500],
  finalizerLeaseMs: [60_000, 24 * 60 * 60_000],
  evaluatorTaskLeaseMs: [30_000, 60 * 60_000],
  queuedTaskBatchSize: [1, 1_000],
  readyTaskScanLimit: [1, 500],
  eventLogAddressBatchSize: [1, 1_000],
  eventLogRecordBatchSize: [100, 100_000],
  prebuildChunkSourceRecordLimit: [1_000, 500_000],
  leaderScoringWindowDays: [1, 730],
  candidateRecentActivityDays: [1, 365],
  botTraderMinAvgDurationMs: [0, 24 * 60 * 60_000],
};

@Injectable()
export class SimulationWorkflowConfigService {
  private cached: SimulationWorkflowConfig = {
    ...SIMULATION_WORKFLOW_DEFAULTS,
  };
  private cachedAt = 0;

  constructor(private readonly prisma: PrismaService) {}

  async get() {
    if (Date.now() - this.cachedAt < 2_000) return this.cached;
    const record = await this.prisma.metadata.findUnique({
      where: { key: SIMULATION_WORKFLOW_CONFIG_KEY },
    });
    this.cached = this.merge(record?.value);
    this.cachedAt = Date.now();
    return this.cached;
  }

  async update(input: SimulationWorkflowConfigInput) {
    const next = this.validate({ ...(await this.get()), ...input });
    await this.prisma.metadata.upsert({
      where: { key: SIMULATION_WORKFLOW_CONFIG_KEY },
      create: {
        key: SIMULATION_WORKFLOW_CONFIG_KEY,
        value: JSON.stringify(next),
      },
      update: { value: JSON.stringify(next) },
    });
    this.cached = next;
    this.cachedAt = Date.now();
    return next;
  }

  async restoreDefaults() {
    await this.prisma.metadata.deleteMany({
      where: { key: SIMULATION_WORKFLOW_CONFIG_KEY },
    });
    this.cached = { ...SIMULATION_WORKFLOW_DEFAULTS };
    this.cachedAt = Date.now();
    return this.cached;
  }

  private merge(value?: string) {
    if (!value) return { ...SIMULATION_WORKFLOW_DEFAULTS };
    try {
      return this.validate({
        ...SIMULATION_WORKFLOW_DEFAULTS,
        ...(JSON.parse(value) as Record<string, unknown>),
      });
    } catch {
      return { ...SIMULATION_WORKFLOW_DEFAULTS };
    }
  }

  private validate(value: Record<string, unknown>): SimulationWorkflowConfig {
    for (const key of Object.keys(SIMULATION_WORKFLOW_DEFAULTS) as Array<
      keyof SimulationWorkflowConfig
    >) {
      const numeric = value[key];
      const [min, max] = bounds[key];
      if (
        typeof numeric !== 'number' ||
        !Number.isSafeInteger(numeric) ||
        numeric < min ||
        numeric > max
      ) {
        throw new BadRequestException(
          `${key} must be an integer from ${min} to ${max}`,
        );
      }
    }
    return value as SimulationWorkflowConfig;
  }
}
