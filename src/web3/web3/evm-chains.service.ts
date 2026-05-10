import { Injectable } from '@nestjs/common';
import {
  createWalletClient,
  createPublicClient,
  WalletClient,
  PublicClient,
  http,
  webSocket,
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
  avalanche,
  megaeth,
  mainnet,
} from 'viem/chains';
import { validateMnemonic } from '@scure/bip39';
import { Mutex, Semaphore } from 'async-mutex';

import 'dotenv';

import { ChainPriority } from 'src/types';

export const privateRPCProviders = {
  drpc: {
    provider: 'drpc',
    getUrl: (network: string, token: string) =>
      `https://lb.drpc.live/${network}/${token}`,
    getWebsocket: (network: string, token: string) =>
      `wss://lb.drpc.live/${network}/${token}`,
    networks: {
      1: 'ethereum',
      137: 'polygon',
      8453: 'base',
      42161: 'arbitrum',
      421614: 'arbitrum-sepolia',
      33139: 'apechain',
      43114: 'avalanche',
      4326: 'megaeth',
    },
    tokens:
      process.env.DRPC_TOKENS?.split(',').filter(
        (item) => item.trim() !== '',
      ) || [],
    paidTokens:
      process.env.DRPC_PAID_TOKENS?.split(',').filter(
        (item) => item.trim() !== '',
      ) || [],
  },
  alchemy: {
    provider: 'alchemy',
    getUrl: (network: string, token: string) =>
      `https://${network}.g.alchemy.com/v2/${token}`,
    getWebsocket: (network: string, token: string) =>
      `wss://${network}.g.alchemy.com/v2/${token}`,
    networks: {
      1: 'ethereum-mainnet',
      137: 'polygon-mainnet',
      8453: 'base-mainnet',
      42161: 'arb-mainnet',
      421614: 'arb-sepolia',
      33139: 'apechain-mainnet',
      43114: 'avalanche-mainnet',
      4326: 'megaeth-mainnet',
    },
    tokens:
      process.env.ALCHEMY_TOKENS?.split(',').filter(
        (item) => item.trim() !== '',
      ) || [],
    paidTokens:
      process.env.ALCHEMY_PAID_TOENS?.split(',').filter(
        (item) => item.trim() !== '',
      ) || [],
  },
};

const publicRpcProviders = {
  1: [
    'https://api.zan.top/eth-mainnet',
    'https://ethereum-rpc.publicnode.com',
    'https://eth-mainnet.public.blastapi.io',
  ],
  137: [
    'https://1rpc.io/matic',
    'https://polygon-bor-rpc.publicnode.com',
    'https://polygon-mainnet.public.blastapi.io',
    'https://polygon.api.onfinality.io/public',
    'https://polygon.meowrpc.com',
    'https://polygon-rpc.com',
    'https://polygon-pokt.nodies.app',
    'https://polygon.drpc.org',
    'https://polygon.rpc.subquery.network/public',
  ],
  8453: [
    'https://1rpc.io/base',
    'https://base-rpc.publicnode.com',
    'https://base-mainnet.public.blastapi.io',
    'https://base.drpc.org',
    'https://base.meowrpc.com',
    'https://mainnet.base.org',
    'https://base-pokt.nodies.app',
    'https://gateway.tenderly.co/public/base',
    'https://base.api.onfinality.io/public',
    'https://rpc.therpc.io/base',
    'https://base.blockpi.network/v1/rpc/public',
  ],
  42161: [
    'https://arb1.arbitrum.io/rpc',
    'https://1rpc.io/arb',
    'https://arbitrum-one-rpc.publicnode.com',
    'https://arbitrum-one.public.blastapi.io',
    'https://arbitrum.meowrpc.com',
    'https://arbitrum.blockpi.network/v1/rpc/public',
    'https://arbitrum.drpc.org',
    'https://rpc.therpc.io/arbitrum',
    'https://arb-pokt.nodies.app',
  ],
  421614: [
    'https://sepolia-rollup.arbitrum.io/rpc',
    'https://arbitrum-sepolia-rpc.publicnode.com',
    'https://arbitrum-sepolia.public.blastapi.io',
    'https://endpoints.omniatech.io/v1/arbitrum/sepolia/public',
    'https://arbitrum-sepolia.drpc.org',
  ],
  33139: [
    'https://rpc.apechain.com/http',
    'https://apechain.gateway.tenderly.co/',
    'https://33139.rpc.thirdweb.com/',
    'https://apechain.drpc.org',
    'https://rpc.apechain.com/http',
  ],
  43114: [
    'https://api.avax.network/ext/bc/C/rpc',
    'https://avalanche.drpc.org',
    'https://ava-mainnet.public.blastapi.io/ext/bc/C/rpc',
    'https://avax.meowrpc.com',
    'https://endpoints.omniatech.io/v1/avax/mainnet/public',
    'https://avalanche-c-chain-rpc.publicnode.com',
    'https://0xrpc.io/avax',
  ],
  4326: [
    'https://rpc-megaeth-mainnet.globalstake.io',
    'https://mainnet.megaeth.com/rpc',
  ],
};

export type Web3Configuration = {
  id: string;
  connection: PublicClient;
  isLocked: boolean;
  lockedAt: number;
  url: string;
  used: number;
};

@Injectable()
export class EvmChainsService {
  readonly availableChains: Chain[];
  readonly freePublicClients: Record<number, PublicClient>;
  readonly privatePublicClients: Record<number, PublicClient>;
  readonly paidPublicClients: Record<number, PublicClient>;
  readonly paidPublicWSClients: Record<number, PublicClient>;
  private readSemaphores: Record<number, Record<ChainPriority, Semaphore>>;
  private writeMutexs: Record<number, Record<string, Mutex>>;
  private walletClients: Record<number, Record<string, WalletClient>>;

  constructor() {
    this.availableChains = [
      arbitrum,
      polygon,
      base,
      arbitrumSepolia,
      apeChain,
      avalanche,
      megaeth,
      mainnet,
    ];
    this.freePublicClients = {};
    this.privatePublicClients = {};
    this.paidPublicClients = {};
    this.paidPublicWSClients = {};
    this.walletClients = {};
    this.readSemaphores = {};
    this.writeMutexs = {};

    this.availableChains.forEach((chain) => {
      this.freePublicClients[chain.id] = createPublicClient({
        chain: chain,
        transport: fallback([
          ...publicRpcProviders[
            chain.id as keyof typeof publicRpcProviders
          ].map((url) => http(url, { batch: true })),
        ]),
        batch: {
          multicall: true,
        },
      }) as unknown as PublicClient;

      const drpcProvider = privateRPCProviders.drpc;

      this.privatePublicClients[chain.id] = createPublicClient({
        chain: chain,
        transport: fallback([
          ...drpcProvider.tokens
            .map((token) =>
              drpcProvider.getUrl(
                drpcProvider.networks[
                  chain.id as keyof typeof drpcProvider.networks
                ],
                token,
              ),
            )
            .map((url) => http(url, { batch: true })),
        ]),
        batch: {
          multicall: true,
        },
      }) as unknown as PublicClient;

      this.paidPublicClients[chain.id] = createPublicClient({
        chain: chain,
        transport: fallback([
          ...drpcProvider.paidTokens
            .map((token) =>
              drpcProvider.getUrl(
                drpcProvider.networks[
                  chain.id as keyof typeof drpcProvider.networks
                ],
                token,
              ),
            )
            .map((url) => http(url, { batch: true })),
        ]),
        batch: {
          multicall: true,
        },
      }) as unknown as PublicClient;

      this.paidPublicWSClients[chain.id] = createPublicClient({
        chain: chain,
        transport: webSocket(
          drpcProvider.getWebsocket(
            drpcProvider.networks[
              chain.id as keyof typeof drpcProvider.networks
            ],
            drpcProvider.paidTokens[0],
          ),
          {
            keepAlive: { interval: 1_000 },
            reconnect: {
              attempts: Infinity,
            },
          },
        ),
      }) as unknown as PublicClient;

      this.readSemaphores[chain.id] = {
        [ChainPriority.HIGH]: new Semaphore(30),
        [ChainPriority.MEDIUM]: new Semaphore(5),
        [ChainPriority.LOW]: new Semaphore(1),
      };
      this.writeMutexs[chain.id] = {};
    });
  }

  private getChainByChainId(chainId: number): Chain | null {
    return this.availableChains.find((item) => item.id === chainId) || null;
  }

  private isValidChainId(chainId: number) {
    return !!this.getChainByChainId(chainId);
  }

  private paidPublicClient(chainId: number): PublicClient {
    if (!this.isValidChainId(chainId)) {
      throw new Error('Invalid chainId');
    }

    return this.paidPublicClients[chainId];
  }

  private privatePublicClient(chainId: number): PublicClient {
    if (!this.isValidChainId(chainId)) {
      throw new Error('Invalid chainId');
    }

    return this.privatePublicClients[chainId];
  }

  private freePublicClient(chainId: number): PublicClient {
    if (!this.isValidChainId(chainId)) {
      throw new Error('Invalid chainId');
    }

    return this.freePublicClients[chainId];
  }

  private publicClient(chainId: number, usePaid = false): PublicClient {
    if (!this.isValidChainId(chainId)) {
      throw new Error('Invalid chainId');
    }

    const freeClient = this.freePublicClient(chainId);
    const privateClient = this.privatePublicClient(chainId);
    const paidClient = this.paidPublicClient(chainId);

    if (usePaid) {
      return paidClient;
    }

    return new Proxy(freeClient, {
      get(target, prop, receiver) {
        const origMethod = Reflect.get(target, prop, receiver);

        if (typeof origMethod !== 'function') {
          return origMethod;
        }

        return async (...args: any[]) => {
          try {
            return await origMethod.apply(freeClient, args);
          } catch (err: any) {
            if (err && typeof err === 'object' && 'cause' in err) {
              const privateMethod = Reflect.get(privateClient, prop, receiver);
              return await privateMethod.apply(privateClient, args);
            }
            throw err;
          }
        };
      },
    });
  }

  paidPublicWSClient(chainId: number): PublicClient {
    if (!this.isValidChainId(chainId)) {
      throw new Error('Invalid chainId');
    }

    return this.paidPublicWSClients[chainId];
  }

  private walletClient(
    chainId: number,
    mnemonic: string,
    accountIndex: number,
    usePaid = false,
  ): WalletClient {
    const chain = this.getChainByChainId(chainId);

    if (!chain) {
      throw new Error('Invalid chain id');
    }

    if (!validateMnemonic(mnemonic, english)) {
      throw new Error('Wrong mnemonic, plz check seed the db metadata');
    }

    const account = mnemonicToAccount(mnemonic, {
      accountIndex,
    });

    if (this.walletClients[chainId]?.[account.address.toLowerCase()]) {
      return this.walletClients[chainId][account.address.toLowerCase()];
    }

    const drpcProvider = privateRPCProviders.drpc;

    const tokens = usePaid ? drpcProvider.paidTokens : drpcProvider.tokens;

    const client = createWalletClient({
      account,
      chain: chain,
      transport: fallback([
        ...tokens
          .map((token) =>
            drpcProvider.getUrl(
              drpcProvider.networks[
                chain.id as keyof typeof drpcProvider.networks
              ],
              token,
            ),
          )
          .map((url) => http(url, { batch: true })),
      ]),
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

  async readWithSemaphore<T>(
    chainId: number,
    priority: ChainPriority,
    callback: (c: PublicClient) => Promise<T>,
    usePaid = false,
  ): Promise<T> {
    return await this.readSemaphores[chainId][priority].runExclusive(
      async () => {
        return await callback(this.publicClient(chainId, usePaid));
      },
    );
  }

  async writeWithMutex<T>(
    chainId: number,
    mnemonic: string,
    accountIndex: number,
    callback: (c: WalletClient) => Promise<T>,
    usePaid = false,
  ): Promise<T> {
    const account = mnemonicToAccount(mnemonic, {
      accountIndex,
    });

    if (!this.writeMutexs[chainId][account.address.toLowerCase()]) {
      this.writeMutexs[chainId][account.address.toLowerCase()] = new Mutex();
    }

    return await this.writeMutexs[chainId][
      account.address.toLowerCase()
    ].runExclusive(async () => {
      return await callback(
        this.walletClient(chainId, mnemonic, accountIndex, usePaid),
      );
    });
  }
}
