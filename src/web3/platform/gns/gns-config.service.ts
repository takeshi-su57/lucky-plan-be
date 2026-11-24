import { Injectable } from '@nestjs/common';
import { Address } from 'viem';
import * as fs from 'fs';
import * as path from 'path';

import { EvmChainsService } from 'src/web3/web3/evm-chains.service';
import { getReadableError } from 'src/utils';

import {
  SerializedGnsCollateral,
  SerializedGnsPair,
  gnsCollateralsSnapshot,
  gnsDiamondDeployments,
  gnsPairsSnapshot,
  serializeGnsCollateral,
  serializeGnsPair,
} from './configs';
import {
  readGnsCollaterals,
  readGnsPairs,
  readGnsPairsCount,
} from './gns-chain-reader';

export type GnsConfigChainReport = {
  chainId: number;
  network: string;
  pairs: number;
  addedPairs: string[];
  renamedPairs: string[];
  collaterals: number;
  error?: string;
};

const pairLabel = (pair: SerializedGnsPair) =>
  `#${pair.pairIndex} ${pair.from}/${pair.to}`;

/**
 * Regenerates the committed GNS config snapshots
 * (`configs/pairs.generated.json`, `configs/collaterals.generated.json`)
 * from the V10 diamonds. Run with `npm run config:generate:gns` and commit
 * the diff.
 *
 * Every pair is re-read so renames are picked up. A chain that fails keeps
 * its previous entries, and a chain whose on-chain list is shorter than the
 * snapshot is rejected: GNS indexes are append-only, so that means a wrong
 * address or RPC, not a delisting.
 */
@Injectable()
export class GnsConfigService {
  constructor(private readonly chainsService: EvmChainsService) {}

  async generateSnapshot(
    configDir = path.resolve(process.cwd(), 'src/web3/platform/gns/configs'),
  ): Promise<GnsConfigChainReport[]> {
    const pairs: Record<string, SerializedGnsPair[]> = {
      ...gnsPairsSnapshot,
    };
    const collaterals: Record<string, SerializedGnsCollateral[]> = {
      ...gnsCollateralsSnapshot,
    };

    const reports = await Promise.all(
      gnsDiamondDeployments.map(async (deployment) => {
        const key = String(deployment.chainId);
        const report: GnsConfigChainReport = {
          chainId: deployment.chainId,
          network: deployment.network,
          pairs: pairs[key]?.length ?? 0,
          addedPairs: [],
          renamedPairs: [],
          collaterals: collaterals[key]?.length ?? 0,
        };

        try {
          const chain = await this.readChain(
            deployment.chainId,
            deployment.address,
          );

          const previousPairs = pairs[key] ?? [];
          const previousCollaterals = collaterals[key] ?? [];

          if (chain.pairs.length < previousPairs.length) {
            throw new Error(
              `on-chain pairsCount ${chain.pairs.length} < snapshot ${previousPairs.length}`,
            );
          }

          if (chain.collaterals.length < previousCollaterals.length) {
            throw new Error(
              `on-chain collaterals ${chain.collaterals.length} < snapshot ${previousCollaterals.length}`,
            );
          }

          for (const pair of chain.pairs) {
            const previous = previousPairs[pair.pairIndex];

            if (!previous) {
              report.addedPairs.push(pairLabel(pair));
            } else if (pairLabel(previous) !== pairLabel(pair)) {
              report.renamedPairs.push(
                `${pairLabel(previous)} -> ${pair.from}/${pair.to}`,
              );
            }
          }

          pairs[key] = chain.pairs;
          collaterals[key] = chain.collaterals;
          report.pairs = chain.pairs.length;
          report.collaterals = chain.collaterals.length;
        } catch (error) {
          report.error = getReadableError(error);
        }

        return report;
      }),
    );

    writeJson(path.join(configDir, 'pairs.generated.json'), pairs);
    writeJson(path.join(configDir, 'collaterals.generated.json'), collaterals);

    return reports;
  }

  private async readChain(chainId: number, address: Address) {
    const pairsCount = await readGnsPairsCount(
      this.chainsService,
      chainId,
      address,
    );

    const [pairs, collaterals] = await Promise.all([
      readGnsPairs(this.chainsService, chainId, address, 0, pairsCount),
      readGnsCollaterals(this.chainsService, chainId, address),
    ]);

    return {
      pairs: pairs.map(serializeGnsPair),
      collaterals: collaterals.map(serializeGnsCollateral),
    };
  }
}

function writeJson(filePath: string, value: unknown) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
