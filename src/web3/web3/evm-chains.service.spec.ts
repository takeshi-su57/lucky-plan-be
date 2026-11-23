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
  it('creates one batch-free worker per dRPC token with the free-plan range', () => {
    const originalTokens = [...privateRPCProviders.drpc.tokens];
    const originalAlchemy = [...privateRPCProviders.alchemy.tokens];
    privateRPCProviders.drpc.tokens = ['token-a', 'token-b'];
    privateRPCProviders.alchemy.tokens = [];

    try {
      const clients = (EvmChainsService.prototype as any)
        .createAggressivePublicClients(arbitrum)
        .filter((client: any) => client.provider === 'drpc');

      // Per-token workers; the shared per-IP limit is enforced by the
      // RpcWorkerPoolService group concurrency cap instead.
      expect(clients.map((client: any) => client.id)).toEqual([
        'drpc:42161:0',
        'drpc:42161:1',
      ]);
      expect(clients.map((client: any) => client.url)).toEqual([
        'https://lb.drpc.live/arbitrum/token-a',
        'https://lb.drpc.live/arbitrum/token-b',
      ]);
      expect(clients[0].maxBlockRange).toBe(100);
      expect(clients[0].client.transport).toEqual({
        type: 'http',
        url: 'https://lb.drpc.live/arbitrum/token-a',
      });
    } finally {
      privateRPCProviders.drpc.tokens = originalTokens;
      privateRPCProviders.alchemy.tokens = originalAlchemy;
    }
  });
});
