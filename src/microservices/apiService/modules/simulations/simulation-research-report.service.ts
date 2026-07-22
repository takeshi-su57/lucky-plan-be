import { Injectable, NotFoundException } from '@nestjs/common';
import { SimulationStatus } from 'generated/prisma/enums';
import { deflateRawSync } from 'zlib';

import { PrismaService } from 'src/global/prisma.service';
import {
  buildRealizedEquityCurve,
  mergeRealizedEquityCurves,
  RealizedEquityPoint,
} from 'src/microservices/analyticsService/modules/simulations/simulation-equity-curve';

type ZipEntry = { name: string; content: string };

function crc32(value: Buffer) {
  let crc = 0xffffffff;
  for (const byte of value) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(entries: ZipEntry[]) {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const content = Buffer.from(entry.content);
    const compressed = deflateRawSync(content);
    const checksum = crc32(content);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    name.copy(local, 30);
    localParts.push(local, compressed);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centralParts.push(central);
    offset += local.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function csv(rows: Record<string, unknown>[]) {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const escape = (value: unknown) => {
    const text = value == null ? '' : String(value);
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return [
    headers.join(','),
    ...rows.map((row) => headers.map((key) => escape(row[key])).join(',')),
  ].join('\n');
}

function parsePositions(value: string, warnings: string[], botId: number) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    warnings.push(
      `Bot ${botId} has unreadable cached positions and was excluded from positions.jsonl.`,
    );
    return [];
  }
}

function parseEquityCurve(value: string | undefined) {
  try {
    const parsed = JSON.parse(value ?? '[]');
    return Array.isArray(parsed) ? (parsed as RealizedEquityPoint[]) : [];
  } catch {
    return [];
  }
}

@Injectable()
export class SimulationResearchReportService {
  constructor(private readonly prisma: PrismaService) {}

  async buildAiStandardZip(researchId: number) {
    const research = await this.prisma.simulationResearch.findUnique({
      where: { id: researchId },
      include: {
        simulations: {
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          include: {
            simulationPlans: {
              orderBy: [{ startAt: 'asc' }, { id: 'asc' }],
              include: {
                cache: true,
                simulationBots: { include: { cache: true } },
              },
            },
          },
        },
      },
    });

    if (!research) throw new NotFoundException('Simulation research not found');
    if (research.status !== SimulationStatus.Completed) {
      throw new Error('Only completed simulation research can be exported');
    }

    const warnings = [
      'Selection evidence and rejected-candidate statistics were not persisted when these simulations ran, so this export cannot reconstruct them.',
      'Cost data is reported separately but is not independently auditable from the current cache; do not infer zero cost from a zero value.',
      'Sibling simulations are alternative configurations over shared windows. Their PnL must not be summed as a portfolio result.',
    ];
    const positions: Record<string, unknown>[] = [];
    const windowRows: Record<string, unknown>[] = [];
    const equityCurves: Record<string, unknown>[] = [];

    const simulations = research.simulations.map(
      (simulation, simulationIndex) => {
        let expectedBotCaches = 0;
        let completedBotCaches = 0;
        let failedBotCaches = 0;
        let rebuildingBotCaches = 0;
        const simulationEquityCurves: RealizedEquityPoint[][] = [];
        const plans = simulation.simulationPlans.map((plan, planIndex) => {
          let realizedEquityCurve = parseEquityCurve(
            plan.cache?.realizedEquityCurveJson,
          );
          // Reports created before v3.14 have no persisted ledger. Recover it
          // from the already-persisted dated follower events for this export;
          // subsequent cache rebuilds persist the same result on the plan.
          if (realizedEquityCurve.length === 0) {
            const cachedPositions = plan.simulationBots.flatMap((bot) =>
              bot.cache?.positionsJson
                ? parsePositions(bot.cache.positionsJson, warnings, bot.id)
                : [],
            );
            realizedEquityCurve = buildRealizedEquityCurve(cachedPositions);
            if (cachedPositions.length > 0) {
              const warning =
                'Some realized-equity curves were reconstructed from dated cached follower events because they predate persisted equity ledgers; rebuild the simulation cache to persist them.';
              if (!warnings.includes(warning)) warnings.push(warning);
            }
          }
          simulationEquityCurves.push(realizedEquityCurve);
          equityCurves.push(
            ...realizedEquityCurve.map((point) => ({
              simulationId: simulation.id,
              simulationIndex: simulationIndex + 1,
              planId: plan.id,
              planIndex: planIndex + 1,
              ...point,
            })),
          );
          const bots = plan.simulationBots.map((bot) => {
            expectedBotCaches += 1;
            if (bot.cache?.completed) completedBotCaches += 1;
            if (bot.cache?.lastError) failedBotCaches += 1;
            if (bot.cache?.rebuilding) rebuildingBotCaches += 1;
            const botPositions = bot.cache?.positionsJson
              ? parsePositions(bot.cache.positionsJson, warnings, bot.id)
              : [];
            botPositions.forEach((position, positionIndex) => {
              const histories = Array.isArray(
                (position as { histories?: unknown }).histories,
              )
                ? (position as { histories: unknown[] }).histories
                : [];
              positions.push({
                simulationId: simulation.id,
                simulationIndex: simulationIndex + 1,
                planId: plan.id,
                planIndex: planIndex + 1,
                botId: bot.id,
                leaderAddress: bot.leaderAddress,
                leaderPlatform: bot.leaderPlatform,
                mode: bot.mode,
                positionIndex: positionIndex + 1,
                leaderPnlUsd:
                  (position as { leaderPnl?: number }).leaderPnl ?? null,
                followerPnlUsd:
                  (position as { followerPnl?: number }).followerPnl ?? null,
                historyCount: histories.length,
              });
            });
            return {
              id: bot.id,
              leaderAddress: bot.leaderAddress,
              leaderPlatform: bot.leaderPlatform,
              mode: bot.mode,
              startedAt: bot.startedAt,
              stoppedAt: bot.stoppedAt,
              selection: {
                score: bot.score,
                baseRatio: bot.ratio,
                evaluationMetrics: {
                  tradeCount: bot.evaluationTradeCount,
                  slope: bot.evaluationSlope,
                  r2: bot.evaluationR2,
                  copiedPnlUsd: bot.evaluationCopiedPnlUsd,
                  copiedProfitFactor: bot.evaluationProfitFactor,
                  copiedMaxDrawdownUsd: bot.evaluationMaxDrawdownUsd,
                },
                leaderPositionEligibility: {
                  minCollateralUsd: bot.minCollateral,
                  maxCollateralUsd: bot.maxCollateral,
                  minSizeUsd: bot.minSize,
                  maxSizeUsd: bot.maxSize,
                  minLeverage: bot.minLeverage,
                  maxLeverage: bot.maxLeverage,
                },
                followerRiskSize: bot.followerRiskSize,
                followerRiskCollateral: bot.followerRiskCollateral,
              },
              aggregation: {
                leaderPnlUsd: bot.cache?.totalLeaderPnl ?? bot.totalPnl,
                followerPnlUsd: bot.cache?.totalFollowerPnl ?? null,
                positionCount: bot.cache?.totalPositions ?? bot.totalPositions,
                openedPositionCount:
                  bot.cache?.openedPositions ?? bot.openedPositions,
                averageDurationMs: bot.cache?.avgDuration ?? bot.avgDuration,
                averageLeverage: bot.cache?.avgLeverage ?? bot.avgLeverage,
              },
              completeness: {
                complete: bot.cache?.completed ?? false,
                rebuilding: bot.cache?.rebuilding ?? false,
                lastError: bot.cache?.lastError ?? null,
                lastFetchedAt: bot.cache?.lastFetchedAt ?? null,
              },
            };
          });
          windowRows.push({
            simulationId: simulation.id,
            simulationIndex: simulationIndex + 1,
            planId: plan.id,
            planIndex: planIndex + 1,
            windowStartAt: plan.startAt.toISOString(),
            windowEndAt: plan.endAt.toISOString(),
            followerPnlUsd:
              plan.cache?.totalFollowerPnl ?? plan.totalFollowerPnl,
            leaderPnlUsd: plan.cache?.totalLeaderPnl ?? plan.totalLeaderPnl,
            positionCount: plan.cache?.totalPositions ?? plan.totalPositions,
            selectedBotCount: bots.length,
          });
          return {
            id: plan.id,
            index: planIndex + 1,
            window: {
              startAt: plan.startAt,
              endAt: plan.endAt,
              cursor: plan.cursor,
            },
            aggregation: {
              leaderPnlUsd: plan.cache?.totalLeaderPnl ?? plan.totalLeaderPnl,
              followerPnlUsd:
                plan.cache?.totalFollowerPnl ?? plan.totalFollowerPnl,
              positionCount: plan.cache?.totalPositions ?? plan.totalPositions,
              openedPositionCount:
                plan.cache?.openedPositions ?? plan.openedPositions,
              chronologicalRealizedEquity: realizedEquityCurve,
            },
            completeness: {
              complete: plan.cache?.completed ?? false,
              completedBots: plan.cache?.completedBots ?? 0,
              incompleteBots: plan.cache?.incompleteBots ?? bots.length,
              lastError: plan.cache?.lastError ?? null,
            },
            bots,
          };
        });
        const chronologicalRealizedEquity = mergeRealizedEquityCurves(
          simulationEquityCurves,
        );
        return {
          overview: {
            id: simulation.id,
            index: simulationIndex + 1,
            status: simulation.status,
            completedPlans: simulation.completedPlans,
            expectedPlans: simulation.totalSimulationPlans,
            completenessRatio: simulation.totalSimulationPlans
              ? simulation.completedPlans / simulation.totalSimulationPlans
              : 0,
          },
          configuration: {
            tradeRanges: simulation.trade,
            r2Ranges: simulation.r2,
            slopeRanges: simulation.slope,
            leaderQualificationCollateralRanges: simulation.collateral,
            leaderQualificationSizeRanges: simulation.size,
            leaderQualificationLeverageRanges: simulation.leverage,
            leaderExecutionCollateralRanges:
              simulation.leaderExecutionCollateral,
            leaderExecutionSizeRanges: simulation.leaderExecutionSize,
            leaderExecutionLeverageRanges: simulation.leaderExecutionLeverage,
            followerRisk: {
              size: simulation.followerRiskSize,
              collateral: simulation.followerRiskCollateral,
            },
            scoreRanges: simulation.score,
            standardCollateralUsd: simulation.standardCollateralUsd,
            scoreFormula: simulation.scoreFormular,
            sizingFormula: simulation.sizingFormular,
          },
          aggregation: {
            leaderPnlUsd: simulation.totalLeaderPnl,
            followerPnlUsd: simulation.totalFollowerPnl,
            reportedNetPnlUsd: simulation.totalNetPnlUsd,
            reportedCostUsd: simulation.totalCostUsd,
            costDataStatus: 'unverified',
            maxDrawdownUsd: simulation.maxDrawdownUsd,
            tradeCount: simulation.tradeCount,
            winRate: simulation.winRate,
            profitFactor: simulation.profitFactor,
            chronologicalRealizedEquity,
          },
          completeness: {
            complete: completedBotCaches === expectedBotCaches,
            completedBotCaches,
            expectedBotCaches,
            failedBotCaches,
            rebuildingBotCaches,
          },
          plans,
        };
      },
    );

    const simulationSummary = research.simulations.map((simulation, index) => ({
      simulationId: simulation.id,
      simulationIndex: index + 1,
      status: simulation.status,
      completedPlans: simulation.completedPlans,
      expectedPlans: simulation.totalSimulationPlans,
      leaderPnlUsd: simulation.totalLeaderPnl,
      followerPnlUsd: simulation.totalFollowerPnl,
      reportedNetPnlUsd: simulation.totalNetPnlUsd,
      reportedCostUsd: simulation.totalCostUsd,
      maxDrawdownUsd: simulation.maxDrawdownUsd,
      tradeCount: simulation.tradeCount,
      winRate: simulation.winRate,
      profitFactor: simulation.profitFactor,
    }));
    const report = {
      reportMetadata: {
        schemaVersion: '1.0.0',
        reportType: 'ai-standard',
        generatedAt: new Date().toISOString(),
        timezone: 'UTC',
        timelineSemantics: {
          planMetrics: 'attributed-to-originating-plan',
          positions: 'attributed-to-originating-plan',
          chronologicalEquity:
            'persisted realized-PnL ledger, ordered by follower event timestamp; excludes unrealized mark-to-market equity and capital/exposure constraints',
        },
      },
      research: {
        overview: {
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
          tradeRanges: research.trade,
          r2Ranges: research.r2,
          slopeRanges: research.slope,
          leaderQualificationCollateralRanges: research.collateral,
          leaderQualificationSizeRanges: research.size,
          leaderQualificationLeverageRanges: research.leverage,
          leaderExecutionCollateralRanges: research.leaderExecutionCollateral,
          leaderExecutionSizeRanges: research.leaderExecutionSize,
          leaderExecutionLeverageRanges: research.leaderExecutionLeverage,
          followerRisk: {
            size: research.followerRiskSize,
            collateral: research.followerRiskCollateral,
          },
          scoreRanges: research.score,
          scoreFormula: research.scoreFormular,
          sizingFormula: research.sizingFormular,
        },
        completeness: {
          complete: research.status === SimulationStatus.Completed,
          status: research.status,
          completedRanges: research.completedRanges,
          totalRanges: research.totalRanges,
        },
      },
      simulations,
      aggregate: {
        simulationComparison: {
          simulationCount: simulations.length,
          completedSimulationCount: simulations.filter(
            (simulation) =>
              simulation.overview.status === SimulationStatus.Completed,
          ).length,
          bestReportedNetPnlSimulationId:
            simulationSummary
              .slice()
              .sort((a, b) => b.reportedNetPnlUsd - a.reportedNetPnlUsd)[0]
              ?.simulationId ?? null,
          lowestDrawdownSimulationId:
            simulationSummary
              .slice()
              .sort((a, b) => a.maxDrawdownUsd - b.maxDrawdownUsd)[0]
              ?.simulationId ?? null,
        },
        sharedWindowComparison: {
          file: 'shared-window-comparison.csv',
          semantics:
            'Rows compare alternative simulations on their matched plan windows.',
        },
        warnings,
      },
    };
    const readme = `# Lucky Plans AI Standard Research Report\n\nThis ZIP contains one completed walk-forward simulation research.\n\n- report.json: canonical hierarchical research report.\n- positions.jsonl: one normalized position summary per line.\n- simulation-summary.csv: one row per alternative simulation.\n- shared-window-comparison.csv: matched plan-window results.\n- realized-equity-curves.jsonl: persisted realized-PnL equity events by plan.\n\nImportant: sibling simulations are alternatives, not one combined portfolio. Read report.json.aggregate.warnings before analysis.\n`;
    return zip([
      { name: 'report.json', content: JSON.stringify(report, null, 2) },
      {
        name: 'positions.jsonl',
        content: positions
          .map((position) => JSON.stringify(position))
          .join('\n'),
      },
      { name: 'simulation-summary.csv', content: csv(simulationSummary) },
      { name: 'shared-window-comparison.csv', content: csv(windowRows) },
      {
        name: 'realized-equity-curves.jsonl',
        content: equityCurves.map((point) => JSON.stringify(point)).join('\n'),
      },
      { name: 'README.md', content: readme },
    ]);
  }
}
