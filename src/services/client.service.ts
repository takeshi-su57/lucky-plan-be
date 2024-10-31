import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createWalletClient,
  createPublicClient,
  WalletClient,
  PublicClient,
  http,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arbitrum, polygon, base, arbitrumSepolia, Chain } from 'viem/chains';

@Injectable()
export class ClientService {
  readonly availableChains: Chain[];
  readonly publicClients: Record<number, PublicClient>;
  readonly walletClients: Record<number, WalletClient>;

  constructor(private configService: ConfigService) {
    this.availableChains = [arbitrum, polygon, base, arbitrumSepolia];
    this.publicClients = {};
    this.walletClients = {};

    try {
      const privateKey = this.configService.get<string>('PRIVATE_KEY');

      const account = privateKeyToAccount(privateKey as `0x`);

      this.availableChains.forEach((chain) => {
        this.walletClients[chain.id] = createWalletClient({
          account,
          chain: chain,
          transport: http(),
        });
        this.publicClients[chain.id] = createPublicClient({
          chain: chain,
          transport: http(),
          batch: {
            multicall: true,
          },
        }) as unknown as PublicClient;
      });
    } catch (err) {
      console.log('Error getting client', err);
    }
  }

  publicClient(chainId: number): PublicClient {
    return this.publicClients[chainId];
  }

  walletClient(chainId: number): WalletClient {
    return this.walletClients[chainId];
  }
}
