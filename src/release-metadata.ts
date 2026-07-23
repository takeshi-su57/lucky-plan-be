import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

export type BackendReleaseMetadata = {
  version: string;
  gitSha: string;
  builtAt: string;
};

const unknownRelease: BackendReleaseMetadata = {
  version: 'unknown',
  gitSha: 'unknown',
  builtAt: 'unknown',
};

export function readBackendReleaseMetadata(): BackendReleaseMetadata {
  const path = join(process.cwd(), 'dist', 'release.json');
  if (!existsSync(path)) return unknownRelease;
  try {
    const value = JSON.parse(
      readFileSync(path, 'utf8'),
    ) as Partial<BackendReleaseMetadata>;
    return {
      version: value.version || 'unknown',
      gitSha: value.gitSha || 'unknown',
      builtAt: value.builtAt || 'unknown',
    };
  } catch {
    return unknownRelease;
  }
}
