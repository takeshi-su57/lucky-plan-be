import { Injectable } from '@nestjs/common';

import {
  createWalletClient,
  createPublicClient,
  WalletClient,
  PublicClient,
  Address,
  http,
  Account,
} from 'viem';
import { arbitrum, arbitrumSepolia, base, polygon, Chain } from 'viem/chains';

@Injectable()
export class ChainsService {
  readonly availableChains: Chain[];
  readonly publicClients: Record<number, PublicClient>;
  private walletClients: Record<number, Record<Address, WalletClient>>;

  constructor() {
    this.availableChains = [arbitrum, polygon, base, arbitrumSepolia];
    this.publicClients = {};
    this.walletClients = {};

    this.availableChains.forEach((chain) => {
      this.publicClients[chain.id] = createPublicClient({
        chain: chain,
        transport: http(),
        batch: {
          multicall: true,
        },
      }) as unknown as PublicClient;
    });
  }

  publicClient(chainId: number): PublicClient {
    if (!this.isValidChainId(chainId)) {
      throw new Error('Invalid chainId');
    }

    return this.publicClients[chainId];
  }

  getChainByChainId(chainId: number): Chain | null {
    return this.availableChains.find((item) => item.id === chainId) || null;
  }

  isValidChainId(chainId: number) {
    return !!this.getChainByChainId(chainId);
  }

  walletClient(chainId: number, account: Account): WalletClient {
    if (this.walletClients[chainId]?.[account.address]) {
      return this.walletClients[chainId][account.address];
    }

    const chain = this.getChainByChainId(chainId);

    if (!chain) {
      throw new Error('Invalid chain id');
    }

    const client = createWalletClient({
      account,
      chain: chain,
      transport: http(),
    });

    if (this.walletClients[chainId]) {
      this.walletClients[chainId][account.address] = client;
    } else {
      this.walletClients[chainId] = {
        [account.address]: client,
      };
    }

    return client;
  }
}
