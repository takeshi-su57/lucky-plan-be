import { Injectable, NotFoundException } from '@nestjs/common';
import { SimulationStatus } from 'generated/prisma/enums';
import { mkdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { PrismaService } from 'src/global/prisma.service';
import {
  getCachedSimulationResearchReportPath,
  getSimulationResearchReportArchivePath,
  getSimulationResearchReportDirectory,
} from 'src/utils/simulation-research-report-cache';
import { ResearchReportArchive } from './simulation-research-report.archive';
import {
  csvCell,
  ResearchReportChunkWriter,
} from './simulation-research-report.chunk-writer';
import {
  addPositionToAggregate,
  createPositionAggregate,
  normalizeExecutedPosition,
  isExecutedFollowerPosition,
  parseCachedEquity,
  iterateCachedPositions,
  summarizePositionAggregate,
} from './simulation-research-report.utils';

@Injectable()
export class SimulationResearchReportService {
  private static readonly PLAN_BATCH_SIZE = 50;
  private readonly builds = new Map<string, Promise<string>>();

  constructor(private readonly prisma: PrismaService) {}

  getAiStandardZipPath(researchId: number, revision: number) {
    return getSimulationResearchReportArchivePath(researchId, revision);
  }

  async getCachedAiStandardZipPath(
    researchId: number,
    revision: number,
  ): Promise<string | null> {
    return getCachedSimulationResearchReportPath(researchId, revision);
  }

  async getReadyAiStandardZipPath(researchId: number): Promise<string | null> {
    const research = await this.prisma.simulationResearch.findUnique({
      where: { id: researchId },
      select: { aiReportReady: true, aiReportRevision: true },
    });
    return research?.aiReportReady
      ? this.getCachedAiStandardZipPath(researchId, research.aiReportRevision)
      : null;
  }

  async getOrBuildAiStandardZip(
    researchId: number,
    revision: number,
  ): Promise<string> {
    const cached = await this.getCachedAiStandardZipPath(researchId, revision);
    if (cached) return cached;
    const key = `${researchId}:${revision}`;
    const active = this.builds.get(key);
    if (active) return active;
    const build = this.writeAiStandardZip(researchId, revision).finally(() =>
      this.builds.delete(key),
    );
    this.builds.set(key, build);
    return build;
  }

  private async writeAiStandardZip(
    researchId: number,
    revision: number,
  ): Promise<string> {
    const target = this.getAiStandardZipPath(researchId, revision);
    const directory = getSimulationResearchReportDirectory(researchId);
    const temporary = join(
      directory,
      `.ai-standard.zip.tmp-${process.pid}-${Date.now()}`,
    );
    await mkdir(directory, { recursive: true });
    try {
      await this.buildAiStandardZip(researchId, temporary);
      await rename(temporary, target);
      return target;
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }

  private async buildAiStandardZip(researchId: number, path: string) {
    const research = await this.prisma.simulationResearch.findUnique({
      where: { id: researchId },
      include: {
        simulations: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
      },
    });
    if (!research) throw new NotFoundException('Simulation research not found');
    if (research.status !== SimulationStatus.Completed)
      throw new Error('Only completed simulation research can be exported');

    const zip = new ResearchReportArchive(path);
    let archiveClosed = false;
    try {
      const warnings = [
        'Raw positions are canonical at plan level and include executed follower-position facts only; source/evaluation histories are excluded.',
        'Sibling simulations are alternative configurations over shared windows. Their PnL must not be summed as a portfolio result.',
      ];
      const simulationSummary = new ResearchReportChunkWriter(
        zip,
        'summaries/simulations',
        'csv',
        'simulationId,simulationIndex,status,planCount,botCount,positionCount,followerPnlUsd,maxDrawdownUsd,profitFactor,winRate',
      );
      const planSummary = new ResearchReportChunkWriter(
        zip,
        'summaries/plans',
        'csv',
        'simulationId,simulationIndex,planId,planIndex,startAt,endAt,botCount,positionCount,followerPnlUsd,leaderPnlUsd,profitFactor,winRate',
      );
      const botSummary = new ResearchReportChunkWriter(
        zip,
        'summaries/bots',
        'csv',
        'simulationId,simulationIndex,planId,planIndex,botId,leaderAddress,platform,score,ratio,positionCount,followerPnlUsd,leaderPnlUsd',
      );
      const manifestSimulations: any[] = [];

      await zip.addText(
        'AI_README.md',
        '# Lucky Plans AI Research Report\n\nStart with `manifest.json`, `research.json`, and `summaries/simulations/`. Each simulation stores at most 50 complete plans in `plans/batch-plans-*.json`. Raw position rows are executed follower-position facts only and must never be summed across sibling simulations.\n',
      );
      await zip.addText(
        'schemas/position.schema.json',
        JSON.stringify(
          {
            type: 'object',
            description:
              'One executed follower-position fact. Histories and evaluation/source events are intentionally excluded.',
            required: ['simulationId', 'planId', 'botId', 'positionIndex'],
            properties: {
              simulationId: { type: 'integer' },
              planId: { type: 'integer' },
              botId: { type: 'integer' },
              positionIndex: { type: 'integer' },
              leaderPnlUsd: { type: ['number', 'null'] },
              followerPnlUsd: { type: ['number', 'null'] },
            },
          },
          null,
          2,
        ),
      );
      await zip.addText(
        'research.json',
        JSON.stringify(
          {
            schemaVersion: '2.0.0',
            reportType: 'luckyplans-ai-research',
            generatedAt: new Date().toISOString(),
            timezone: 'UTC',
            research: {
              id: research.id,
              title: research.title,
              description: research.description,
              platform: research.platform,
              direction: research.direction,
              startAt: research.startAt,
              endAt: research.endAt,
              planDurationDays: research.days,
              gapDays: research.gapDays,
              totalPlanWindows: research.totalRanges,
              totalSimulations: research.simulations.length,
            },
            parameterSpace: {
              trade: research.trade,
              r2: research.r2,
              slope: research.slope,
              collateral: research.collateral,
              size: research.size,
              leverage: research.leverage,
              score: research.score,
              scoreFormula: research.scoreFormular,
              sizingFormula: research.sizingFormular,
              behavioralFilters: research.behavioralFilters,
            },
          },
          null,
          2,
        ),
      );

      for (const [
        simulationIndex,
        simulation,
      ] of research.simulations.entries()) {
        const simulationPath = `simulations/simulation-${String(simulationIndex + 1).padStart(3, '0')}`;
        const simulationAggregate = createPositionAggregate();
        let botCount = 0;
        let planBatch: any[] = [];
        let planBatchIndex = 0;
        const planBatchFiles: string[] = [];
        const flushPlanBatch = async () => {
          if (!planBatch.length) return;
          planBatchIndex += 1;
          const filename = `${simulationPath}/plans/batch-plans-${String(planBatchIndex).padStart(5, '0')}.json`;
          await zip.addText(
            filename,
            JSON.stringify({ schemaVersion: '3.0.0', plans: planBatch }),
          );
          planBatchFiles.push(filename);
          planBatch = [];
        };
        const planHeaders = await this.prisma.simulationPlan.findMany({
          where: { simulationId: simulation.id },
          orderBy: [{ startAt: 'asc' }, { id: 'asc' }],
          select: { id: true },
        });

        for (const [planIndex, planHeader] of planHeaders.entries()) {
          const plan = await this.prisma.simulationPlan.findUniqueOrThrow({
            where: { id: planHeader.id },
            include: { cache: true },
          });
          const aggregate = createPositionAggregate();
          const positionRows: any[] = [];
          const botRecords: any[] = [];
          const botHeaders = await this.prisma.simulationBot.findMany({
            where: { simulationPlanId: plan.id },
            orderBy: { id: 'asc' },
          });

          for (const botHeader of botHeaders) {
            // Loading the cache here, not in findMany, keeps only one bot's
            // potentially-large positionsJson string resident at a time.
            const bot = await this.prisma.simulationBot.findUniqueOrThrow({
              where: { id: botHeader.id },
              include: { cache: true },
            });
            botCount += 1;
            const rawPositions = bot.cache?.positionsJson
              ? iterateCachedPositions(
                  bot.cache.positionsJson,
                  warnings,
                  bot.id,
                )
              : [];
            const context = {
              simulationId: simulation.id,
              simulationIndex: simulationIndex + 1,
              planId: plan.id,
              planIndex: planIndex + 1,
              botId: bot.id,
              leaderAddress: bot.leaderAddress,
              leaderPlatform: bot.leaderPlatform,
              mode: bot.mode,
            };
            let positionIndex = 0;
            for (const rawPosition of rawPositions) {
              positionIndex += 1;
              if (!isExecutedFollowerPosition(rawPosition)) continue;
              const position = normalizeExecutedPosition(
                rawPosition,
                context,
                positionIndex - 1,
              );
              positionRows.push(position);
              addPositionToAggregate(aggregate, position);
              addPositionToAggregate(simulationAggregate, position);
            }
            botRecords.push({
              id: bot.id,
              leaderAddress: bot.leaderAddress,
              leaderPlatform: bot.leaderPlatform,
              mode: bot.mode,
              startedAt: bot.startedAt,
              stoppedAt: bot.stoppedAt,
              selection: {
                score: bot.score,
                ratio: bot.ratio,
                evaluationMetrics: {
                  tradeCount: bot.evaluationTradeCount,
                  slope: bot.evaluationSlope,
                  r2: bot.evaluationR2,
                },
                behavioralFeatures: bot.behavioralFeatures ?? null,
              },
              aggregation: {
                leaderPnlUsd: bot.cache?.totalLeaderPnl ?? bot.totalPnl,
                followerPnlUsd: bot.cache?.totalFollowerPnl ?? null,
                positionCount: bot.cache?.totalPositions ?? bot.totalPositions,
              },
              positionCount: bot.cache?.totalPositions ?? bot.totalPositions,
            });
            await botSummary.writeLine(
              [
                simulation.id,
                simulationIndex + 1,
                plan.id,
                planIndex + 1,
                bot.id,
                bot.leaderAddress,
                bot.leaderPlatform,
                bot.score,
                bot.ratio,
                bot.cache?.totalPositions ?? bot.totalPositions,
                bot.cache?.totalFollowerPnl ?? '',
                bot.cache?.totalLeaderPnl ?? bot.totalPnl,
              ]
                .map(csvCell)
                .join(','),
            );
          }

          const equity = parseCachedEquity(plan.cache?.realizedEquityCurveJson);
          const summary = summarizePositionAggregate(aggregate);
          planBatch.push({
            id: plan.id,
            index: planIndex + 1,
            simulationId: simulation.id,
            window: {
              startAt: plan.startAt,
              endAt: plan.endAt,
              cursor: plan.cursor,
            },
            cache: {
              completed: plan.cache?.completed ?? false,
              completedBots: plan.cache?.completedBots ?? 0,
              incompleteBots: plan.cache?.incompleteBots ?? botHeaders.length,
              lastError: plan.cache?.lastError ?? null,
            },
            summary,
            bots: botRecords,
            positions: positionRows,
            realizedEquity: equity.map((point) => ({
              planId: plan.id,
              ...point,
            })),
          });
          if (
            planBatch.length >= SimulationResearchReportService.PLAN_BATCH_SIZE
          )
            await flushPlanBatch();
          await planSummary.writeLine(
            [
              simulation.id,
              simulationIndex + 1,
              plan.id,
              planIndex + 1,
              plan.startAt.toISOString(),
              plan.endAt.toISOString(),
              botHeaders.length,
              summary.positionCount,
              summary.followerPnlUsd,
              summary.leaderPnlUsd,
              summary.profitFactor ?? '',
              summary.winRate,
            ]
              .map(csvCell)
              .join(','),
          );
        }

        await flushPlanBatch();
        const summary = summarizePositionAggregate(simulationAggregate);
        await zip.addText(
          `${simulationPath}/simulation.json`,
          JSON.stringify(
            {
              id: simulation.id,
              index: simulationIndex + 1,
              status: simulation.status,
              configuration: {
                trade: simulation.trade,
                r2: simulation.r2,
                slope: simulation.slope,
                collateral: simulation.collateral,
                size: simulation.size,
                leverage: simulation.leverage,
                score: simulation.score,
                behavioralFilters: simulation.behavioralFilters,
              },
              reportedMetrics: {
                followerPnlUsd: simulation.totalFollowerPnl,
                netPnlUsd: simulation.totalNetPnlUsd,
                maxDrawdownUsd: simulation.maxDrawdownUsd,
                profitFactor: simulation.profitFactor,
                winRate: simulation.winRate,
              },
              summary,
              planCount: planHeaders.length,
              botCount,
              planBatchFiles,
            },
            null,
            2,
          ),
        );
        await simulationSummary.writeLine(
          [
            simulation.id,
            simulationIndex + 1,
            simulation.status,
            planHeaders.length,
            botCount,
            summary.positionCount,
            summary.followerPnlUsd,
            simulation.maxDrawdownUsd,
            summary.profitFactor ?? simulation.profitFactor,
            summary.winRate,
          ]
            .map(csvCell)
            .join(','),
        );
        manifestSimulations.push({
          id: simulation.id,
          index: simulationIndex + 1,
          directory: simulationPath,
          metadataFile: `${simulationPath}/simulation.json`,
          planCount: planHeaders.length,
          executedPositionCount: summary.positionCount,
          planBatchFiles,
        });
      }

      const summaryFiles = {
        simulations: await simulationSummary.close(),
        plans: await planSummary.close(),
        bots: await botSummary.close(),
      };
      await zip.addText('warnings.json', JSON.stringify(warnings, null, 2));
      await zip.addText(
        'manifest.json',
        JSON.stringify(
          {
            schemaVersion: '3.0.0',
            reportType: 'luckyplans-ai-research',
            generatedAt: new Date().toISOString(),
            research: { id: research.id, metadataFile: 'research.json' },
            analysisGuide: {
              firstRead: [
                'AI_README.md',
                'manifest.json',
                'research.json',
                ...summaryFiles.simulations,
              ],
              simulationSummaryFiles: summaryFiles.simulations,
              planSummaryFiles: summaryFiles.plans,
              botSummaryFiles: summaryFiles.bots,
              rawPositionFormat: 'JSON arrays embedded in plan batches',
              rawPositionSemantics: 'executed follower positions only',
              positionHistoryIncluded: false,
              canonicalPositionLevel: 'plan',
            },
            simulations: manifestSimulations,
          },
          null,
          2,
        ),
      );
      await zip.close();
      archiveClosed = true;
    } finally {
      if (!archiveClosed) await zip.abort();
    }
  }
}
