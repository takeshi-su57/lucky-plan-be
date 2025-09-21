import { Injectable } from '@nestjs/common';
import { web3 } from '@coral-xyz/anchor';
import { nanoid } from 'nanoid';
import 'dotenv';

import { privateRPCProviders as evmPrivateRPCProviders } from './evm-chains.service';

const privateRPCProviders = {
  drpc: {
    provider: 'drpc',
    getSolanaUrl: (token: string) => `https://lb.drpc.org/solana/${token}`,
    tokens: evmPrivateRPCProviders.drpc.tokens,
  },
};

const publicRpcProviders = [
  'https://delicate-clean-sheet.solana-mainnet.quiknode.pro/ef458f6369e04c2dddbfbc52a495dd686f1c2765',
  'https://go.getblock.us/1f226b5206b94058b9f68d9443d9b0b0',
  'https://solana-mainnet.core.chainstack.com/c588bbb990c79ae740b1ccf7990bf80f',
  'https://api.mainnet-beta.solana.com',
];

export type Web3Configuration = {
  id: string;
  connection: web3.Connection;
  isLocked: boolean;
  lockedAt: number;
};

@Injectable()
export class SolanaChainsService {
  private rpcPools: Record<string, Web3Configuration> = {};

  constructor() {
    [...publicRpcProviders, ...privateRPCProviders.drpc.tokens].forEach(
      (url) => {
        const id = nanoid();

        this.rpcPools[id] = {
          id,
          connection: new web3.Connection(url),
          isLocked: false,
          lockedAt: 0,
        };
      },
    );
  }

  async getAvailableConnection(): Promise<Web3Configuration> {
    return new Promise<Web3Configuration>((resolve) => {
      const interval = setInterval(() => {
        const availableConnection = Object.values(this.rpcPools).find(
          (pool) => !pool.isLocked,
        );

        if (availableConnection) {
          clearInterval(interval);
          this.lockConnection(availableConnection.id);
          resolve(availableConnection);
        }
      }, 100);
    });
  }

  lockConnection(id: string) {
    this.rpcPools[id].isLocked = true;
    this.rpcPools[id].lockedAt = Date.now();
  }

  unlockConnection(id: string) {
    const interval = setInterval(() => {
      if (this.rpcPools[id].lockedAt + 1000 < Date.now()) {
        clearInterval(interval);
        this.rpcPools[id].isLocked = false;
      }
    }, 100);
  }
}
