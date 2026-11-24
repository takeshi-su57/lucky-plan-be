import { PrismaService } from 'src/global/prisma.service';

import {
  PlatformConfigChainReport,
  PlatformConfigChainStatus,
  platformConfigStatusKey,
} from './platform-config.types';

/** Persists the latest check/sync report so every process and the UI see it. */
export async function savePlatformConfigReport(
  prismaService: PrismaService,
  report: PlatformConfigChainReport,
) {
  const key = platformConfigStatusKey(report.platform, report.chainId);
  const row = await prismaService.metadata.findUnique({ where: { key } });
  const status: PlatformConfigChainStatus = row
    ? (JSON.parse(row.value) as PlatformConfigChainStatus)
    : {};

  if (report.mode === 'sync') {
    status.lastSync = report;
  } else {
    status.lastCheck = report;
  }

  const value = JSON.stringify(status);

  await prismaService.metadata.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
}

export async function loadPlatformConfigStatuses(
  prismaService: PrismaService,
): Promise<Map<string, PlatformConfigChainStatus>> {
  const rows = await prismaService.metadata.findMany({
    where: { key: { startsWith: 'config.status.' } },
  });

  return new Map(
    rows.map((row) => [
      row.key,
      JSON.parse(row.value) as PlatformConfigChainStatus,
    ]),
  );
}
