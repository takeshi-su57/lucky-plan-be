import { Injectable } from '@nestjs/common';
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
  avalanche,
} from 'viem/chains';
import { validateMnemonic } from '@scure/bip39';
import { Mutex, Semaphore, withTimeout } from 'async-mutex';
import { nanoid } from 'nanoid';

import 'dotenv';

import { ChainPriority } from 'src/types';

export const privateRPCProviders = {
  drpc: {
    provider: 'drpc',
    getUrl: (network: string, token: string) =>
      `https://lb.drpc.org/ogrpc?network=${network}&dkey=${token}`,
    networks: {
      137: 'polygon',
      8453: 'base',
      42161: 'arbitrum',
      421614: 'arbitrum-sepolia',
      33139: 'apechain',
      43114: 'avalanche',
    },
    tokens: [
      'AnxSCzrS6kLymZIBqC68tbmkEZm5J1oR8IUSEjfP07KJ',
      'AtA3DzvN80VAuMXpEuYs0Mwy1dvpKa4R8I32EjfP07KJ',
      'AujdrLCySkHriKcgivXkfC0gs51UKa8R8I35EjfP07KJ',
      'Asn7XUs2fkptrHY34vZx5MFV10lJKbMR8I4FEjfP07KJ',
      'Aiio8plb7kwEgVttGQTB3IEuci3CKbUR8I4OEjfP07KJ',
      'AtlOYq-ZCkL8jXgPHIzwPncmB_E4LAsR8JkoEjfP07KJ',
      'AloSriF4B0nggEsKDMYiOnCUPYBmLAwR8JktEjfP07KJ',
      'ApKBwP0pl0l6ln5RcDDqlLlFHxYWLA4R8JkyEjfP07KJ',
      'AkNxllrJh0nksMTENrcqKm1DFf5kMWER8JFMzoXPVSjK',
      'ApVf0uNDHkPam4cKtEZkmdOABGQQMWIR8JFmzoXPVSjK',
      'Ai7nDC0ZDkOIuUPRt36OQX8VJV66MWMR8JFvzoXPVSjK',
      'AuMyZSJJTUrJm17HmV-gSBKLouOVMWMR8JF0zoXPVSjK',
      'AqDEH4eq0kRIjc40MipYGQEAGVw1MWQR8JF2zoXPVSjK',
      'AkswE_iiZUmtiPuxd0CraLwC6_hnMWUR8JF6zoXPVSjK',
      'An5iFO58sk0nlEXPDJCF_6XLwuqPMWUR8JGAzoXPVSjK',
      'AtktOWrzeUTEi2EVRcWmUKIa4ZYKNVER8KcdbrRhIxXF',
      'Aqq3FuSAAED6kMaZiiiLXCeU8nNfNVER8KcibrRhIxXF',
      'AkQNsv9c6E_1qKEVLn2s0ygVbTupNVIR8KcjbrRhIxXF',
      'AmdqXkkNLUGYmQXRDL-5igWAobmiNVIR8KckbrRhIxXF',
      'An4YvT8YRUFwt8RqK1hWUg_zfgBINVIR8KcnbrRhIxXF',
      'AlR_TmfXQUU-pB7upZ6E0-Z18O97NVMR8KcqbrRhIxXF',
      'AifMkmm5G0pnvqmEBLdeSrX9FFmsNVMR8KcrbrRhIxXF',
      'Ard4jC4mIk0XsnxBlrzM9rufePoANVQR8KcwbrRhIxXF',
      'AmZAx6KHJEz3n9Bj00HP0foWrZtGNVUR8KcybrRhIxXF',
      'Ago1ytX_50a7nn9yE2Qdq6MN-zZvNVYR8Kc2brRhIxXF',
      'AjfXw1CrM0jCosH83uXA2CIZOBxyNVcR8Kc5brRhIxXF',
      'AtPNaMCuBURqjAcNlkanGoh8sK2ZNVcR8Kc7brRhIxXF',
      'AhGDkiI8E0fhgJ9gbdPfXPUfVgxxkw8R8I42zltYSRe_',
      'AgNu2FsZsELPo7SkO6ko15R9h5lWkw8R8I43zltYSRe_',
      'AqKJv9sjPEX_iXfLEttlJOS9Ax1Qkw8R8I44zltYSRe_',
      'AkRrJFiVgECelg92H7TKWtP_-l5Xkw8R8I45zltYSRe_',
      'Aq2mSEztfEtnmOLyxoatvr85j3lEkxAR8I46zltYSRe_',
      'AuKd0G6EF01oioIfRzuafMhxJ6dmkxAR8I47zltYSRe_',
      'AqtKk9PeCEZBqKUvQww9n2trk0TvkxER8I48zltYSRe_',
    ],
  },
  alchemy: {
    provider: 'alchemy',
    getUrl: (network: string, token: string) =>
      `https://${network}.g.alchemy.com/v2/${token}`,
    getWebsocket: (network: string, token: string) =>
      `wss://${network}.g.alchemy.com/v2/${token}`,
    networks: {
      137: 'polygon-mainnet',
      8453: 'base-mainnet',
      42161: 'arb-mainnet',
      421614: 'arb-sepolia',
      33139: 'apechain-mainnet',
      43114: 'avalanche-mainnet',
    },
    tokens: [
      'Zxh4D-fVDWSXyUJbN5ZITVgjbET7-9N_', // 'takeshisuz
      'fDh9_XoNmoCdrrqPuU6wxoKRuSP1OM90',
      'OUfJrKB_TzPSqYwzk0KgjeNDg_bb4k2u', // brunopalma
      'JsxyfNiRtf4XV58c4onA7-QdK2_UA6-o',
      'wzmljbYQCRX6Mq6tkQy5npdZQTAOY_iQ', // takeshisuz
      'qf9Xqi-AIXnz1_mNnbgbN', // wpope
    ],
  },
};

const publicRpcProviders = {
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
  readonly paidPublicClients: Record<number, PublicClient>;
  private readSemaphores: Record<number, Record<ChainPriority, Semaphore>>;
  private writeMutexs: Record<number, Record<string, Mutex>>;
  private walletClients: Record<number, Record<string, WalletClient>>;
  private publicWalletClients: Record<
    number,
    Record<string, Web3Configuration>
  > = {};

  constructor() {
    this.availableChains = [
      arbitrum,
      polygon,
      base,
      arbitrumSepolia,
      apeChain,
      avalanche,
    ];
    this.freePublicClients = {};
    this.paidPublicClients = {};
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

      this.paidPublicClients[chain.id] = createPublicClient({
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

      this.readSemaphores[chain.id] = {
        [ChainPriority.HIGH]: withTimeout(
          new Semaphore(30),
          60000,
        ) as Semaphore,
        [ChainPriority.MEDIUM]: withTimeout(
          new Semaphore(5),
          60000,
        ) as Semaphore,
        [ChainPriority.LOW]: withTimeout(new Semaphore(1), 60000) as Semaphore,
      };
      this.writeMutexs[chain.id] = {};

      this.publicWalletClients[chain.id] = {};

      [
        ...publicRpcProviders[chain.id as keyof typeof publicRpcProviders],
        ...drpcProvider.tokens.map((token) =>
          drpcProvider.getUrl(
            drpcProvider.networks[
              chain.id as keyof typeof drpcProvider.networks
            ],
            token,
          ),
        ),
      ].forEach((url) => {
        const id = nanoid();

        this.publicWalletClients[chain.id][id] = {
          id,
          connection: createPublicClient({
            chain: chain,
            transport: http(url, { batch: true }),
          }),
          isLocked: false,
          lockedAt: 0,
          url,
          used: 0,
        };
      });
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

  private freePublicClient(chainId: number): PublicClient {
    if (!this.isValidChainId(chainId)) {
      throw new Error('Invalid chainId');
    }

    return this.freePublicClients[chainId];
  }

  private publicClient(chainId: number): PublicClient {
    if (!this.isValidChainId(chainId)) {
      throw new Error('Invalid chainId');
    }

    const freeClient = this.freePublicClient(chainId);
    const paidClient = this.paidPublicClient(chainId);

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
              const paidMethod = Reflect.get(paidClient, prop, receiver);
              return await paidMethod.apply(paidClient, args);
            }
            throw err;
          }
        };
      },
    });
  }

  private walletClient(
    chainId: number,
    mnemonic: string,
    accountIndex: number,
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

    const client = createWalletClient({
      account,
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
  ): Promise<T> {
    return await this.readSemaphores[chainId][priority].runExclusive(
      async () => {
        return await callback(this.publicClient(chainId));
      },
    );
  }

  async writeWithMutex<T>(
    chainId: number,
    mnemonic: string,
    accountIndex: number,
    callback: (c: WalletClient) => Promise<T>,
  ): Promise<T> {
    const account = mnemonicToAccount(mnemonic, {
      accountIndex,
    });

    if (!this.writeMutexs[chainId][account.address.toLowerCase()]) {
      this.writeMutexs[chainId][account.address.toLowerCase()] = withTimeout(
        new Mutex(),
        60000,
      ) as Mutex;
    }

    return await this.writeMutexs[chainId][
      account.address.toLowerCase()
    ].runExclusive(async () => {
      return await callback(this.walletClient(chainId, mnemonic, accountIndex));
    });
  }

  async getAvailableConnection(chainId: number): Promise<Web3Configuration> {
    return new Promise<Web3Configuration>((resolve) => {
      const interval = setInterval(() => {
        const availableConnection = Object.values(
          this.publicWalletClients[chainId],
        )
          .filter((pool) => !pool.isLocked)
          .sort((a, b) => a.used - b.used);

        if (availableConnection.length > 0) {
          this.lockConnection(chainId, availableConnection[0].id);
          resolve(availableConnection[0]);
          clearInterval(interval);
        }
      }, 100);
    });
  }

  lockConnection(chainId: number, id: string) {
    this.publicWalletClients[chainId][id].isLocked = true;
    this.publicWalletClients[chainId][id].lockedAt = Date.now();
    this.publicWalletClients[chainId][id].used++;
  }

  unlockConnection(chainId: number, id: string, waitTime: number) {
    const interval = setInterval(() => {
      if (
        this.publicWalletClients[chainId][id].lockedAt + waitTime <
        Date.now()
      ) {
        this.publicWalletClients[chainId][id].isLocked = false;
        clearInterval(interval);
      }
    }, 1000);
  }
}
