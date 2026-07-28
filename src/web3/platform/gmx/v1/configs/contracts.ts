/**
 * GMX V1 is intentionally treated as a closed historical source.
 * `toBlock` is inclusive and is capped immediately before
 * 2025-01-01T00:00:00.000Z, per the backfill scope.
 */
export const gmxV1HistoryCutoff = {
  iso: '2025-01-01T00:00:00.000Z',
  unixSeconds: 1_735_689_600,
} as const;

export const gmxV1VaultDeployments = [
  {
    chainId: 42_161,
    network: 'Arbitrum',
    address: '0x489ee077994b6658eafa855c308275ead8097c4a',
    fromBlock: 227_000,
    toBlock: 290_687_173,
    description: 'GMX V1 Vault on Arbitrum (history through 2024-12-31 UTC)',
  },
  {
    chainId: 43_114,
    network: 'Avalanche',
    address: '0x9ab2de34a33fb459b538c43f251eb825645e8595',
    fromBlock: 8_351_228,
    toBlock: 55_159_595,
    description: 'GMX V1 Vault on Avalanche (history through 2024-12-31 UTC)',
  },
] as const;
