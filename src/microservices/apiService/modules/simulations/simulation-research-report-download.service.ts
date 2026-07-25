import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/global/prisma.service';
import { getCachedSimulationResearchReportPath } from 'src/utils/simulation-research-report-cache';

/** Lightweight API-side reader for reports published by analytics. */
@Injectable()
export class SimulationResearchReportDownloadService {
  constructor(private readonly prisma: PrismaService) {}

  async getReadyArchivePath(researchId: number): Promise<string | null> {
    const research = await this.prisma.simulationResearch.findUnique({
      where: { id: researchId },
      select: { aiReportReady: true, aiReportRevision: true },
    });
    if (!research?.aiReportReady) return null;

    return getCachedSimulationResearchReportPath(
      researchId,
      research.aiReportRevision,
    );
  }
}
