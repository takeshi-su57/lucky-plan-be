import { rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const CACHE_ROOT = resolve(process.cwd(), '.cache', 'research');

export function getSimulationResearchReportDirectory(researchId: number) {
  return join(CACHE_ROOT, String(researchId));
}

export function getSimulationResearchReportArchivePath(
  researchId: number,
  revision: number,
) {
  return join(
    getSimulationResearchReportDirectory(researchId),
    `ai-standard-v2-r${revision}.zip`,
  );
}

export async function getCachedSimulationResearchReportPath(
  researchId: number,
  revision: number,
) {
  const path = getSimulationResearchReportArchivePath(researchId, revision);
  try {
    const file = await stat(path);
    return file.isFile() && file.size > 0 ? path : null;
  } catch {
    return null;
  }
}

/** Removes only the exact report cache for a research after its input changes. */
export async function invalidateSimulationResearchReport(researchId: number) {
  await rm(getSimulationResearchReportDirectory(researchId), {
    recursive: true,
    force: true,
  });
}
