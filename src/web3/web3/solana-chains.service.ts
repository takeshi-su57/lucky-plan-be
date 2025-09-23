import { Injectable } from '@nestjs/common';
import { web3 } from '@coral-xyz/anchor';
import { nanoid } from 'nanoid';
import 'dotenv';

import { privateRPCProviders as evmPrivateRPCProviders } from './evm-chains.service';
import { getReadableError } from 'src/utils';
import { LogsService } from 'src/global/logs.service';

const privateRPCProviders = {
  drpc: {
    provider: 'drpc',
    getSolanaUrl: (token: string) => `https://lb.drpc.org/solana/${token}`,
    tokens: evmPrivateRPCProviders.drpc.tokens,
  },
  syndica: {
    provider: 'syndica',
    getSolanaUrl: (token: string) =>
      `https://solana-mainnet.api.syndica.io/api-key/${token}`,
    tokens: [
      '3SR9HyqDkQXGXFbpVDeqZwXmSgUstE5CFfqD6sEqKuCj8VbNMq8ok1SagYCQqGe6us2Ay2HjqETpxez2UkGYo1owZHNXtu7Pfoz', // takeshisuz
      '3Uz71SDAReBbFeoQJmAsAGjhhWJDoh1Seo4kbZ5MEWzZ7wJ8RZJCMNUa4XpdJeeSQUvmGAGvrZRXLPgeXkGceVKSQJ25J3WqW63', // brunopalma480
      '3kPsJAUpV49BFF6Tuc6VmLPGLzEcKPcSLkDFoUmu9Q7BRGHuHEB7qxN7qSoXyAqA97XYUJdqRRNgoUMRmcegrPVrzXqzHJCyB5g', // bill-pope
      '3n7B78jSwDFM5yJ7LgZ5kofVMrLfCYM74NEtFxuMPG26mZP9kjKMJAGt43fK2ZeGkvsffN7WTXF1R1m2jzgVK7ksGBZ8gBFEVMn', // chad wood,
      '3opUv6z5PNMY5psgJS15gfNNzGQGMrio4SyEsgycpr3geVXuQ9TKa3AGXRYABcSQefqeq9u7dVtzY8DfVfgcUaJp8JoF1EERwHc', // chung wong
      '3rPSdZN24c1rBh2mropei6XAdfkzQg3gfZfRcDdgEG4Wi2hziAkXfgMymu3wa73Pj2TejaXR4EfZqVPRQ5b3cYo6t3w2ypgEyfn', // hiroshi-tan
      '3t6kSXceWm7ybUETdPJFvNRA43FTc2JKycbsd23mQzB6aWwi75F191uo14R1TDFuCirE2Hk4vngiU3MgoZ6U6wNoE7TGfj2so2y', // unipine29
      '3up4FVsGxvEBa6ewJMrxwCQZx7mtfFrUcLoPWqyZg7jjB6J7uvBqRSCZ437dnbLXnchrpWPWYX3CzWdcTbywuaPqdPb3KHzC6jE', // unipinedev
    ],
  },
  alchemy: {
    provider: 'alchemy',
    getSolanaUrl: (token: string) =>
      `https://solana-mainnet.g.alchemy.com/v2/${token}`,
    tokens: evmPrivateRPCProviders.alchemy.tokens,
  },
  helius: {
    provider: 'helius',
    getSolanaUrl: (token: string) =>
      `https://mainnet.helius-rpc.com/?api-key=${token}`,
    tokens: [
      '41808816-a044-479a-a614-987e37c16362', // takeshisuz
      '29ce982b-4fa8-4a4f-8bc8-6530cdac19c6', // brunopalma480
      '2982d167-00cb-4e45-8edd-1290942b5a5a', // dev-danbi
      'f195985c-b0b4-42ce-a7fd-a43a899c41ed', // bill-pope
      '29f339f0-711f-43db-af28-76d5e42fa818', // chad-wood
      '15e2ed59-926e-47af-8d2d-5419a123814d', // chung wong
      'bb35e461-5d29-4c24-9cc4-fc01ca542fb7', // hiroshi-tan
      '5f884137-1cbf-47d7-957e-b70f4bd471fa', // unipine 29
      '178ff595-1021-4e17-9877-d8dcd0631154', // unipinedev
    ],
  },
  getBlock: {
    provider: 'getBlock',
    getSolanaUrl: (token: string) => `https://go.getblock.us/${token}`,
    tokens: [
      '1f226b5206b94058b9f68d9443d9b0b0', // takeshisuz
      'a09d9213ecb34f1fa63b1387d0d0903e', // takeshisuz
      '1fae80271a28497b8d6614428e9a5a61', // brunopalma480
      'bc476996f5754121b097a51f9049c2ff', // brunopalma480
      'e36072891bd74ce0979ec8c3f7743d62', // dev-danbi
      'ecbfafd487254615a71f5273f040f3da', // dev-danbi
      'c43dd5b800094325870a894be2e36731', // bill-pope
      'b42f384a15af4b2da25d1b6640381e82', // bill-pope
      '20e103758f6642b9b886312f898267c0', // chad wood,
      '2496eb75b083463b9c4f2a739bc04342', // chad wood,
      'c869516616834710878606c697868e2a', // chung wong
      '03563641b778435c9fe0e23affdf872b', // chung wong
      '2f41cbcf34f74b1ab65c20c156a157b8', // hiroshi-tan
      '33a560e1c1674b1cbd1cb1a1cb7b8ec0', // hiroshi-tan
      '79cb53fbcfaf42c0b3e7053819c8ee2e', // unipine29
      '534a182045474c45a088bbcaab8bf995', // unipine29
      '86ed3cd5adc74f1e8b552ad571123ade', // unipinedev
      'e4590347e553402f8c7062c6195c0816', // unipinedev
    ],
  },
  chainstack: {
    provider: 'chainstack',
    getSolanaUrl: (token: string) =>
      `https://solana-mainnet.core.chainstack.com/${token}`,
    tokens: [
      'c588bbb990c79ae740b1ccf7990bf80f', // takeshisuz
      'e418809748afc20f7b4568230d37c3e5', // brunopalma480
      '9fe0a0f21c760099a2707c9482fa7b49', // dev-danbi
      'cced31da32cb0d2ac7fb63af7db8531b', // bill-pope
      'c9fe71ba5c7348f0dfda8dd657d9dc62', // chad wood
      'be772e39018d13f2d5edf60fd22e860e', // chung wong
      '29a5d97d79b940c37d7cec5eb04def66', // unipine29
      'c6b67688b510ca34c7825157f4c8398c', // unipinedev
    ],
  },
};

const publicRpcProviders = [
  'https://delicate-clean-sheet.solana-mainnet.quiknode.pro/ef458f6369e04c2dddbfbc52a495dd686f1c2765',
  'https://api.mainnet-beta.solana.com',
];

export type Web3Configuration = {
  id: string;
  connection: web3.Connection;
  isLocked: boolean;
  lockedAt: number;
  url: string;
  used: number;
};

@Injectable()
export class SolanaChainsService {
  rpcPools: Record<string, Web3Configuration> = {};
  totalRpcPools: number = 0;

  constructor(private readonly logger: LogsService) {
    [
      ...publicRpcProviders,
      ...Object.values(privateRPCProviders)
        .map((provider) =>
          provider.tokens.map((token) => provider.getSolanaUrl(token)),
        )
        .flat(),
    ].forEach((url) => {
      const id = nanoid();

      this.rpcPools[id] = {
        id,
        connection: new web3.Connection(url),
        isLocked: false,
        lockedAt: 0,
        url,
        used: 0,
      };

      this.totalRpcPools++;
    });
  }

  async getAvailableConnection(): Promise<Web3Configuration> {
    return new Promise<Web3Configuration>((resolve) => {
      const interval = setInterval(() => {
        const availableConnection = Object.values(this.rpcPools)
          .filter((pool) => !pool.isLocked)
          .sort((a, b) => a.used - b.used);

        if (availableConnection.length > 0) {
          this.lockConnection(availableConnection[0].id);
          resolve(availableConnection[0]);
          clearInterval(interval);
        }
      }, 100);
    });
  }

  lockConnection(id: string) {
    this.rpcPools[id].isLocked = true;
    this.rpcPools[id].lockedAt = Date.now();
    this.rpcPools[id].used++;
  }

  unlockConnection(id: string) {
    const interval = setInterval(() => {
      if (this.rpcPools[id].lockedAt + 10_000 < Date.now()) {
        this.rpcPools[id].isLocked = false;
        clearInterval(interval);
      }
    }, 100);
  }

  async getSignaturesForAddress(
    address: web3.PublicKey,
    options: {
      before?: string;
      until?: string;
    },
  ): Promise<Array<web3.ConfirmedSignatureInfo>> {
    const connection = await this.getAvailableConnection();

    try {
      const result = await connection.connection.getSignaturesForAddress(
        address,
        options,
      );

      this.unlockConnection(connection.id);

      return result;
    } catch (err) {
      this.logger.log({
        severity: 'Critical',
        summary: 'Error getting signatures for address',
        details: getReadableError(err),
      });

      this.unlockConnection(connection.id);

      return await this.getSignaturesForAddress(address, options);
    }
  }

  async getTransactions(
    signatures: string[],
  ): Promise<(web3.VersionedTransactionResponse | null)[]> {
    const connection = await this.getAvailableConnection();

    try {
      const result = await connection.connection.getTransactions(signatures, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      });

      console.log('result', result.length > 0 ? result[0]?.slot : 'null');

      this.unlockConnection(connection.id);

      return result;
    } catch (err) {
      this.logger.log({
        severity: 'Critical',
        summary: 'Error getting transactions',
        details: getReadableError(err),
      });

      this.unlockConnection(connection.id);

      return await this.getTransactions(signatures);
    }
  }
}
