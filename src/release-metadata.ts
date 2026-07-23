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
  // In the compiled service this module is dist/src/release-metadata.js, so
  // this path remains correct even when a process manager uses another cwd.
  // Keep the cwd path for source-mode development and existing deployments.
  const paths = [
    join(__dirname, '..', 'release.json'),
    join(process.cwd(), 'dist', 'release.json'),
  ];
  for (const path of paths) {
    if (!existsSync(path)) continue;
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
      // A stale or partial metadata file must not prevent the fallback path
      // from being used.
    }
  }
  return unknownRelease;
}
