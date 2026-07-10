import { describe, expect, it, jest } from '@jest/globals';
import { arbitrum } from 'viem/chains';

import { EvmChainsService, privateRPCProviders } from './evm-chains.service';

jest.mock('@scure/bip39', () => ({
  validateMnemonic: jest.fn(() => true),
}));

jest.mock('viem/accounts', () => ({
  english: {},
  mnemonicToAccount: jest.fn(() => ({
    address: '0x0000000000000000000000000000000000000001',
  })),
}));

jest.mock('viem', () => ({
  createPublicClient: jest.fn((config) => config),
  createWalletClient: jest.fn((config) => config),
  fallback: jest.fn((transports) => ({ type: 'fallback', transports })),
  http: jest.fn((url) => ({ type: 'http', url })),
  webSocket: jest.fn((url) => ({ type: 'webSocket', url })),
}));

describe('EvmChainsService aggressive public clients', () => {
  it('groups dRPC token URLs into one worker for the shared IP limit', () => {
    const originalTokens = [...privateRPCProviders.drpc.tokens];
    privateRPCProviders.drpc.tokens = ['token-a', 'token-b'];
    privateRPCProviders.alchemy.tokens = [];

    try {
      const clients = (EvmChainsService.prototype as any)
        .createAggressivePublicClients(arbitrum)
        .filter((client: any) => client.provider === 'drpc');

      expect(clients).toHaveLength(1);
      expect(clients[0].id).toBe('drpc:42161');
      expect(clients[0].url).toBe('drpc:2-tokens');
      expect(clients[0].client.transport).toEqual({
        type: 'fallback',
        transports: [
          {
            type: 'http',
            url: 'https://lb.drpc.live/arbitrum/token-a',
          },
          {
            type: 'http',
            url: 'https://lb.drpc.live/arbitrum/token-b',
          },
        ],
      });
    } finally {
      privateRPCProviders.drpc.tokens = originalTokens;
    }
  });
});
