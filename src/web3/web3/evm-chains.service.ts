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

import {
  FREE_PLAN_MAX_BLOCK_RANGE,
  privateRPCProviders,
  publicRpcProviders,
} from './rpc-providers';

export { privateRPCProviders } from './rpc-providers';

export type Web3Configuration = {
  id: string;
  connection: PublicClient;
  isLocked: boolean;
  lockedAt: number;
  url: string;
  used: number;
};

export type AggressivePublicClient = {
  id: string;
  provider: string;
  url: string;
  client: PublicClient;
  maxBlockRange?: number | null;
};

@Injectable()
export class EvmChainsService {
  readonly availableChains: Chain[];
  readonly freePublicClients: Record<number, PublicClient>;
  readonly privatePublicClients: Record<number, PublicClient>;
  readonly paidPublicClients: Record<number, PublicClient>;
  readonly paidPublicWSClients: Record<number, PublicClient>;
  private aggressivePublicClients: Record<number, AggressivePublicClient[]>;
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
    this.aggressivePublicClients = {};
    this.walletClients = {};
    this.readSemaphores = {};
    this.writeMutexs = {};

    this.availableChains.forEach((chain) => {
      this.freePublicClients[chain.id] = createPublicClient({
        chain: chain,
        transport: fallback([
          ...publicRpcProviders[chain.id].map((url) =>
            http(url, { batch: true }),
          ),
        ]),
        batch: {
          multicall: true,
        },
      });

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
      });

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
      });

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
      });

      this.aggressivePublicClients[chain.id] =
        this.createAggressivePublicClients(chain);

      this.readSemaphores[chain.id] = {
        [ChainPriority.HIGH]: new Semaphore(30),
        [ChainPriority.MEDIUM]: new Semaphore(5),
        [ChainPriority.LOW]: new Semaphore(1),
      };
      this.writeMutexs[chain.id] = {};
    });
  }

  /**
   * Builds a single-endpoint client for the aggressive backfill. Batching is
   * off: getLogs is one call per request anyway, and several public RPCs
   * answer JSON-RPC batches with a non-array body that viem cannot parse.
   */
  createAggressiveClient(chainId: number, url: string): PublicClient {
    const chain = this.getChainByChainId(chainId);

    if (!chain) {
      throw new Error('Invalid chainId');
    }

    return createPublicClient({
      chain,
      transport: http(url, { batch: false, retryCount: 0, timeout: 30_000 }),
    });
  }

  /** Fallback worker list used when no RpcEndpoint rows exist for a chain. */
  private createAggressivePublicClients(
    chain: Chain,
  ): AggressivePublicClient[] {
    const chainPublicRpcProviders = publicRpcProviders[chain.id] || [];

    const clients: AggressivePublicClient[] = chainPublicRpcProviders.map(
      (url, index) => ({
        id: `public:${chain.id}:${index}`,
        provider: 'public',
        url,
        client: createPublicClient({
          chain,
          transport: http(url, {
            batch: false,
            retryCount: 0,
            timeout: 30_000,
          }),
        }),
      }),
    );

    // One worker per token: a fallback() transport over all tokens would only
    // ever use the first token and serialize every request through it.
    Object.values(privateRPCProviders).forEach((provider) => {
      const network =
        provider.networks[chain.id as keyof typeof provider.networks];

      if (!network) {
        return;
      }

      provider.tokens.forEach((token, index) => {
        const url = provider.getUrl(network, token);

        clients.push({
          id: `${provider.provider}:${chain.id}:${index}`,
          provider: provider.provider,
          url,
          maxBlockRange: FREE_PLAN_MAX_BLOCK_RANGE[provider.provider] ?? null,
          client: createPublicClient({
            chain,
            transport: http(url, {
              batch: false,
              retryCount: 0,
              timeout: 30_000,
            }),
          }),
        });
      });
    });

    const urls = new Set<string>();

    return clients.filter(({ url }) => {
      if (urls.has(url)) {
        return false;
      }

      urls.add(url);
      return true;
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

  getAggressivePublicClients(chainId: number): AggressivePublicClient[] {
    if (!this.isValidChainId(chainId)) {
      throw new Error('Invalid chainId');
    }

    return this.aggressivePublicClients[chainId];
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
