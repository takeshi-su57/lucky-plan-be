import { Injectable } from '@nestjs/common';
import { Follower } from 'src/follower/entities/follower.entity';

import {
  createWalletClient,
  createPublicClient,
  WalletClient,
  PublicClient,
  http,
} from 'viem';
import { english, mnemonicToAccount } from 'viem/accounts';
import { arbitrum, arbitrumSepolia, base, polygon, Chain } from 'viem/chains';
import { PrismaService } from './prisma.service';
import { validateMnemonic } from '@scure/bip39';

@Injectable()
export class ChainsService {
  readonly availableChains: Chain[];
  readonly publicClients: Record<number, PublicClient>;
  private walletClients: Record<number, Record<string, WalletClient>>;
  private mnemonic: string;

  constructor(private prismaService: PrismaService) {
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

    this.loadMnemonic();
  }

  async loadMnemonic() {
    const mnemonicMetadata = await this.prismaService.metadata.findUnique({
      where: {
        key: this.prismaService.metadataKeys.mnemonic.key,
      },
    });

    const mnemonicValue = mnemonicMetadata?.value || '';

    if (!validateMnemonic(mnemonicValue, english)) {
      throw new Error('Wrong mnemonic, plz check seed the db metadata');
    }

    this.mnemonic = mnemonicValue;
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

  walletClient(chainId: number, follower: Follower): WalletClient {
    if (this.walletClients[chainId]?.[follower.address]) {
      return this.walletClients[chainId][follower.address];
    }

    const chain = this.getChainByChainId(chainId);

    if (!chain) {
      throw new Error('Invalid chain id');
    }

    if (!this.mnemonic) {
      throw new Error('Not loaded Mnemonic');
    }

    const account = mnemonicToAccount(this.mnemonic, {
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
