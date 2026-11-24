import { Platform } from 'generated/prisma/client';

export type PlatformConfigMode = 'check' | 'sync';

/**
 * Result of comparing (check) or applying (sync) one chain's live config
 * source against what the parsers currently use.
 */
export type PlatformConfigChainReport = {
  platform: Platform;
  chainId: number;
  network: string;
  mode: PlatformConfigMode;
  /** Items the source (chain / GMX API) lists. */
  sourceCount: number;
  /** Items the parsers know after this run. */
  effectiveCount: number;
  /** Listed by the source but not known to the parsers (before this run). */
  missing: string[];
  /** Known, but different from the source (renamed, decimals, active flag). */
  changed: string[];
  /** Items written to the runtime overlay by a sync. */
  applied: string[];
  error: string | null;
  finishedAt: number;
};

/** Metadata key holding the last check/sync report of a chain. */
export const platformConfigStatusKey = (platform: Platform, chainId: number) =>
  `config.status.${platform}.${chainId}`;

export type PlatformConfigChainStatus = {
  lastCheck?: PlatformConfigChainReport;
  lastSync?: PlatformConfigChainReport;
};

export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
