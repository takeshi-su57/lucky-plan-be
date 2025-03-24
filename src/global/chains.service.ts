import { Injectable } from '@nestjs/common';
import { Follower } from 'src/follower/entities/follower.entity';

import {
  createWalletClient,
  createPublicClient,
  WalletClient,
  PublicClient,
  http,
  fallback,
} from 'viem';
import { english, mnemonicToAccount } from 'viem/accounts';
import {
  arbitrum,
  arbitrumSepolia,
  base,
  polygon,
  apeChain,
  Chain,
} from 'viem/chains';
import { PrismaService } from './prisma.service';

import { validateMnemonic } from '@scure/bip39';

const rpcUrls = {
  137: [
    'https://1rpc.io/matic',
    'https://polygon-mainnet.g.alchemy.com/v2/wzmljbYQCRX6Mq6tkQy5npdZQTAOY_iQ',
    'https://polygon-bor-rpc.publicnode.com',
    'https://rpc.ankr.com/polygon/1a678463ad0a874876ae86cb3eb01c56ea1de36dc52f7d6fb6473cea5386f340',
    'https://polygon-mainnet.public.blastapi.io',
  ],
  8453: [
    'https://1rpc.io/base',
    'https://base-mainnet.g.alchemy.com/v2/wzmljbYQCRX6Mq6tkQy5npdZQTAOY_iQ',
    'https://base-rpc.publicnode.com',
    'https://base-mainnet.public.blastapi.io',
  ],
  42161: [
    'https://1rpc.io/arb',
    'https://arb-mainnet.g.alchemy.com/v2/wzmljbYQCRX6Mq6tkQy5npdZQTAOY_iQ',
    'https://arbitrum-one-rpc.publicnode.com',
    'https://rpc.ankr.com/arbitrum/1a678463ad0a874876ae86cb3eb01c56ea1de36dc52f7d6fb6473cea5386f340',
    'https://arbitrum-one.public.blastapi.io',
  ],
  421614: [
    'https://arb-sepolia.g.alchemy.com/v2/wzmljbYQCRX6Mq6tkQy5npdZQTAOY_iQ',
    'https://arbitrum-sepolia-rpc.publicnode.com',
    'https://rpc.ankr.com/arbitrum_sepolia/1a678463ad0a874876ae86cb3eb01c56ea1de36dc52f7d6fb6473cea5386f340',
    'https://arbitrum-sepolia.public.blastapi.io',
  ],
  33139: [
    'https://rpc.apechain.com/http',
    'https://apechain.gateway.tenderly.co/',
    'https://33139.rpc.thirdweb.com/',
  ],
};

@Injectable()
export class ChainsService {
  readonly availableChains: Chain[];
  readonly publicClients: Record<number, PublicClient>;
  private walletClients: Record<number, Record<string, WalletClient>>;

  constructor(private prismaService: PrismaService) {
    this.availableChains = [arbitrum, polygon, base, arbitrumSepolia, apeChain];
    this.publicClients = {};
    this.walletClients = {};

    this.availableChains.forEach((chain) => {
      this.publicClients[chain.id] = createPublicClient({
        chain: chain,
        transport: fallback(
          [
            http(),
            ...rpcUrls[chain.id as keyof typeof rpcUrls].map((url) =>
              http(url),
            ),
          ],
          {
            rank: {
              timeout: 100_000,
            },
          },
        ),
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

  walletClient(
    mnemonic: string,
    chainId: number,
    follower: Follower,
  ): WalletClient {
    if (this.walletClients[chainId]?.[follower.address]) {
      return this.walletClients[chainId][follower.address];
    }

    const chain = this.getChainByChainId(chainId);

    if (!chain) {
      throw new Error('Invalid chain id');
    }

    if (!validateMnemonic(mnemonic, english)) {
      throw new Error('Wrong mnemonic, plz check seed the db metadata');
    }

    const account = mnemonicToAccount(mnemonic, {
      accountIndex: follower.accountIndex,
    });

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
