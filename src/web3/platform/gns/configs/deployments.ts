/**
 * GNS V10 diamonds the config generator reads pairs and collaterals from.
 * Kept here (not only in the DB) so `npm run config:generate:gns` works
 * against a fresh database. Must match the V10 rows in `prisma/seed.ts`.
 */
export const gnsDiamondDeployments = [
  {
    chainId: 137,
    network: 'Polygon',
    address: '0x209a9a01980377916851af2ca075c2b170452018',
  },
  {
    chainId: 8453,
    network: 'Base',
    address: '0x6cd5ac19a07518a8092eeffda4f1174c72704eeb',
  },
  {
    chainId: 42161,
    network: 'Arbitrum',
    address: '0xff162c694eaa571f685030649814282ea457f169',
  },
  {
    chainId: 33139,
    network: 'ApeChain',
    address: '0x2be5d7058adba14bc38e4a83e94a81f7491b0163',
  },
  {
    chainId: 4326,
    network: 'MegaETH',
    address: '0x2d5b1ba6e2093a5b927fe5bf8c049b107de31eaf',
  },
] as const;
