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
import 'dotenv';

import { validateMnemonic } from '@scure/bip39';
import { EncryptedData, SecurityService } from './security.service';

const rpcUrls = {
  137: [
    ...(process.env.ENV === 'production'
      ? [
          'https://lb.drpc.org/ogrpc?network=polygon&dkey=AnxSCzrS6kLymZIBqC68tbmkEZm5J1oR8IUSEjfP07KJ',
        ]
      : [
          'https://1rpc.io/matic',
          'https://polygon-mainnet.g.alchemy.com/v2/Zxh4D-fVDWSXyUJbN5ZITVgjbET7-9N_',
          'https://polygon-bor-rpc.publicnode.com',
        ]),
  ],
  8453: [
    ...(process.env.ENV === 'production'
      ? [
          'https://lb.drpc.org/ogrpc?network=base&dkey=AnxSCzrS6kLymZIBqC68tbmkEZm5J1oR8IUSEjfP07KJ',
        ]
      : [
          'https://1rpc.io/base',
          'https://base-mainnet.g.alchemy.com/v2/Zxh4D-fVDWSXyUJbN5ZITVgjbET7-9N_',
          'https://base-rpc.publicnode.com',
        ]),
  ],
  42161: [
    ...(process.env.ENV === 'production'
      ? [
          'https://lb.drpc.org/ogrpc?network=arbitrum&dkey=AnxSCzrS6kLymZIBqC68tbmkEZm5J1oR8IUSEjfP07KJ',
        ]
      : [
          'https://1rpc.io/arb',
          'https://arb-mainnet.g.alchemy.com/v2/Zxh4D-fVDWSXyUJbN5ZITVgjbET7-9N_',
          'https://arbitrum-one-rpc.publicnode.com',
        ]),
  ],
  421614: [
    ...(process.env.ENV === 'production'
      ? [
          'https://lb.drpc.org/ogrpc?network=arbitrum-sepolia&dkey=AnxSCzrS6kLymZIBqC68tbmkEZm5J1oR8IUSEjfP07KJ',
        ]
      : [
          'https://arb-sepolia.g.alchemy.com/v2/Zxh4D-fVDWSXyUJbN5ZITVgjbET7-9N_',
          'https://arbitrum-sepolia-rpc.publicnode.com',
          'https://rpc.ankr.com/arbitrum_sepolia/1a678463ad0a874876ae86cb3eb01c56ea1de36dc52f7d6fb6473cea5386f340',
        ]),
  ],
  33139: [
    ...(process.env.ENV === 'production'
      ? [
          'https://lb.drpc.org/ogrpc?network=apechain&dkey=AnxSCzrS6kLymZIBqC68tbmkEZm5J1oR8IUSEjfP07KJ',
        ]
      : [
          'https://rpc.apechain.com/http',
          'https://apechain.gateway.tenderly.co/',
          'https://33139.rpc.thirdweb.com/',
        ]),
  ],
};

@Injectable()
export class ChainsService {
  readonly availableChains: Chain[];
  readonly publicClients: Record<number, PublicClient>;
  private walletClients: Record<number, Record<string, WalletClient>>;

  constructor(private securityService: SecurityService) {
    this.availableChains = [arbitrum, polygon, base, arbitrumSepolia, apeChain];
    this.publicClients = {};
    this.walletClients = {};

    this.availableChains.forEach((chain) => {
      this.publicClients[chain.id] = createPublicClient({
        chain: chain,
        transport: fallback(
          [
            ...rpcUrls[chain.id as keyof typeof rpcUrls].map((url) =>
              http(url),
            ),
            // http(),
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
    mnemonicStr: string,
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

    const mnemonic = this.securityService.isSafeApp
      ? this.securityService.decrypt(JSON.parse(mnemonicStr) as EncryptedData)
      : mnemonicStr;

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
