import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

import { EvmChainsService } from 'src/web3/web3/evm-chains.service';

import { readAvntPairs, readAvntPairsCount } from './avnt-chain-reader';
import { avntPairsSnapshot, preserveRetiredAvntNames } from './v1/configs';
import { Pair } from './v1/types';

export type AvntConfigReport = {
  pairs: number;
  addedPairs: string[];
  renamedPairs: string[];
};

const pairLabel = (pair: Pair) => `#${pair.pairIndex} ${pair.from}/${pair.to}`;

/**
 * Regenerates the committed Avantis pair snapshot
 * (`v1/configs/pairs.generated.json`) from PairStorage on Base. Run with
 * `npm run config:generate:avnt` and commit the diff. Every pair is re-read
 * so renames are picked up (except delist renames, see
 * `preserveRetiredAvntNames`); a shorter on-chain list is rejected because pair
 * indexes are append-only.
 */
@Injectable()
export class AvntConfigService {
  constructor(private readonly chainsService: EvmChainsService) {}

  async generateSnapshot(
    outputPath = path.resolve(
      process.cwd(),
      'src/web3/platform/avnt/v1/configs/pairs.generated.json',
    ),
  ): Promise<AvntConfigReport> {
    const pairsCount = await readAvntPairsCount(this.chainsService);

    if (pairsCount < avntPairsSnapshot.length) {
      throw new Error(
        `on-chain pairsCount ${pairsCount} < snapshot ${avntPairsSnapshot.length}`,
      );
    }

    const pairs = preserveRetiredAvntNames(
      await readAvntPairs(this.chainsService, 0, pairsCount),
      (pairIndex) => avntPairsSnapshot[pairIndex],
    );
    const report: AvntConfigReport = {
      pairs: pairs.length,
      addedPairs: [],
      renamedPairs: [],
    };

    for (const pair of pairs) {
      const previous = avntPairsSnapshot[pair.pairIndex];

      if (!previous) {
        report.addedPairs.push(pairLabel(pair));
      } else if (pairLabel(previous) !== pairLabel(pair)) {
        report.renamedPairs.push(
          `${pairLabel(previous)} -> ${pair.from}/${pair.to}`,
        );
      }
    }

    fs.writeFileSync(outputPath, `${JSON.stringify(pairs, null, 2)}\n`);

    return report;
  }
}
