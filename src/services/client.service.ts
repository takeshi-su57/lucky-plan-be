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
import { arbitrum, polygon, base, arbitrumSepolia } from 'viem/chains';

@Injectable()
export class ClientService {
  readonly sepoliaWallet: WalletClient;
  readonly sepoliaPublic: PublicClient;

  readonly arbitrumWallet: WalletClient;
  readonly arbitrumPublic: PublicClient;

  readonly polygonWallet: WalletClient;
  readonly polygonPublic: PublicClient;

  readonly baseWallet: WalletClient;
  readonly basePublic: PublicClient;

  constructor(private configService: ConfigService) {
    try {
      const privateKey = this.configService.get<string>('PRIVATE_KEY');

      const account = privateKeyToAccount(privateKey as `0x`);

      this.sepoliaWallet = createWalletClient({
        account,
        chain: arbitrumSepolia,
        transport: http(),
      });
      this.sepoliaPublic = createPublicClient({
        chain: arbitrumSepolia,
        transport: http(),
        batch: {
          multicall: true,
        },
      }) as unknown as PublicClient;

      this.arbitrumWallet = createWalletClient({
        account,
        chain: arbitrum,
        transport: http(),
      });
      this.arbitrumPublic = createPublicClient({
        chain: arbitrum,
        transport: http(),
        batch: {
          multicall: true,
        },
      }) as unknown as PublicClient;

      this.polygonWallet = createWalletClient({
        account,
        chain: polygon,
        transport: http(),
      });
      this.polygonPublic = createPublicClient({
        chain: polygon,
        transport: http(),
        batch: {
          multicall: true,
        },
      }) as unknown as PublicClient;

      this.baseWallet = createWalletClient({
        account,
        chain: base,
        transport: http(),
      });
      this.basePublic = createPublicClient({
        chain: base,
        transport: http(),
        batch: {
          multicall: true,
        },
      }) as unknown as PublicClient;
    } catch (err) {
      console.log('Error getting client', err);
    }
  }
}
