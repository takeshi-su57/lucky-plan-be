import { Injectable } from '@nestjs/common';
import {
  createWalletClient,
  createPublicClient,
  WalletClient,
  PublicClient,
  http,
  fallback,
  Address,
  AbiEvent,
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
import { Mutex } from 'async-mutex';
import 'dotenv';

import { EncryptedData, SecurityService } from '../global/security.service';
import { Follower } from 'src/follower/entities/follower.entity';

const privateRPCProviders = [
  {
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
    ],
  },
  {
    provider: 'alchemy',
    getUrl: (network: string, token: string) =>
      `'https://${network}.g.alchemy.com/v2/${token}`,
    networks: {
      137: 'polygon-mainnet',
      8453: 'base-mainnet',
      42161: 'arb-mainnet',
      421614: 'arb-sepolia',
      33139: 'apechain-mainnet',
      43114: 'avalanche-mainnet',
    },
    tokens: [
      'Zxh4D-fVDWSXyUJbN5ZITVgjbET7-9N_',
      'fDh9_XoNmoCdrrqPuU6wxoKRuSP1OM90',
      'OUfJrKB_TzPSqYwzk0KgjeNDg_bb4k2u',
      'JsxyfNiRtf4XV58c4onA7-QdK2_UA6-o',
    ],
  },
];

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

@Injectable()
export class ChainsService {
  readonly availableChains: Chain[];
  readonly freePublicClients: Record<number, PublicClient>;
  readonly paidPublicClients: Record<number, PublicClient>;
  private readMutexs: Record<number, Mutex>;
  private writeMutexs: Record<number, Mutex>;
  private walletClients: Record<number, Record<string, WalletClient>>;

  constructor(private securityService: SecurityService) {
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
    this.readMutexs = {};
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

      this.paidPublicClients[chain.id] = createPublicClient({
        chain: chain,
        transport: fallback([
          ...privateRPCProviders
            .map((item) =>
              item.tokens.map((token) =>
                item.getUrl(
                  item.networks[chain.id as keyof typeof item.networks],
                  token,
                ),
              ),
            )
            .flat()
            .map((url) => http(url, { batch: true })),
        ]),
        batch: {
          multicall: true,
        },
      }) as unknown as PublicClient;

      this.readMutexs[chain.id] = new Mutex();
      this.writeMutexs[chain.id] = new Mutex();
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

  private walletClient(
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
      transport: fallback([
        ...privateRPCProviders
          .map((item) =>
            item.tokens.map((token) =>
              item.getUrl(
                item.networks[chain.id as keyof typeof item.networks],
                token,
              ),
            ),
          )
          .flat()
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

  private async readWithFailover<T>(
    chainId: number,
    fn: (c: PublicClient) => Promise<T>,
  ): Promise<T> {
    const freeClient = this.freePublicClient(chainId);
    const paidClient = this.paidPublicClient(chainId);

    try {
      return await fn(freeClient);
    } catch (err: unknown) {
      if (typeof err === 'object' && err !== null && 'cause' in (err as any)) {
        return await fn(paidClient);
      }

      throw err;
    }
  }

  async getBlockNumber(chainId: number) {
    return await this.readMutexs[chainId].runExclusive(async () => {
      return await this.readWithFailover(
        chainId,
        async (client) => await client.getBlockNumber(),
      );
    });
  }

  async getBlock(chainId: number, blockNumber: bigint) {
    return await this.readMutexs[chainId].runExclusive(async () => {
      return await this.readWithFailover(
        chainId,
        async (client) => await client.getBlock({ blockNumber }),
      );
    });
  }

  async getLogs(
    chainId: number,
    address: Address,
    fromBlock: bigint,
    toBlock: bigint,
  ) {
    return await this.readMutexs[chainId].runExclusive(async () => {
      return await this.readWithFailover(
        chainId,
        async (client) =>
          await client.getLogs<AbiEvent>({
            address,
            fromBlock,
            toBlock,
          }),
      );
    });
  }
}
