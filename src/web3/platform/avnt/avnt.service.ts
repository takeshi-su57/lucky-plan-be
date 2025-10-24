import { Injectable } from '@nestjs/common';
import { Address } from 'viem';
import { base } from 'viem/chains';
import * as fs from 'fs';
import * as path from 'path';

import { pairStorageAbi } from './v1/abi/PairStorage';

import { EvmChainsService } from 'src/web3/web3/evm-chains.service';

import { ChainPriority } from 'src/types';
import { contractAddresses } from './v1/configs';

@Injectable()
export class AvntService {
  constructor(private readonly chainsService: EvmChainsService) {
    // this.loadPairData();
  }

  async loadPairData() {
    const pairsCount = await this.chainsService.readWithSemaphore(
      base.id,
      ChainPriority.LOW,
      async (publicClient) => {
        return await publicClient.readContract({
          address: contractAddresses.PairStorage as Address,
          abi: pairStorageAbi,
          functionName: 'pairsCount',
          args: [],
        });
      },
    );

    console.log('pairsCount', pairsCount);

    const pairsData: {
      pairIndex: number;
      from: string;
      to: string;
      numTiers: bigint;
    }[] = [];

    for (let i = 0; i < Number(pairsCount); i++) {
      const pairData = await this.chainsService.readWithSemaphore(
        base.id,
        ChainPriority.LOW,
        async (publicClient) => {
          return await publicClient.readContract({
            address: contractAddresses.PairStorage as Address,
            abi: pairStorageAbi,
            functionName: 'pairData',
            args: [BigInt(i)],
          });
        },
      );

      pairsData.push({
        pairIndex: i,
        from: pairData[0],
        to: pairData[1],
        numTiers: pairData[2],
      });
    }

    const pairs = pairsData;
    const pairsConfigPath = path.join(__dirname, 'pairs-config.json');
    // Ensure the directory exists before writing the file
    const ensureDirectoryExistence = (filePath: string) => {
      const dirname = path.dirname(filePath);
      if (fs.existsSync(dirname)) {
        return true;
      }
      fs.mkdirSync(dirname, { recursive: true });
    };

    // Ensure the directory exists for pairsConfigPath
    ensureDirectoryExistence(pairsConfigPath);

    console.log('pairsConfigPath', pairsConfigPath);

    fs.writeFileSync(
      pairsConfigPath,
      JSON.stringify(
        pairs,
        (_, v) => (typeof v === 'bigint' ? v.toString() : v),
        2,
      ),
    );

    console.log('stored on the config.json');
  }
}
