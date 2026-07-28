import { describe, expect, it } from '@jest/globals';

import {
  getGmxV1IndexTokenConfig,
  gmxV1IndexTokenConfigs,
  resolveGmxV1Pair,
} from './tokens';
import { toGmxV1AssetSymbol } from './token-normalization';

describe('GMX V1 index-token registry', () => {
  it.each([
    [42_161, '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', 'eth/usd'],
    [42_161, '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f', 'btc/usd'],
    [42_161, '0xf97f4df75117a78c1A5a0DBb814Af92458539FB4', 'link/usd'],
    [42_161, '0xFa7F8980b0f1E64A2062791cc3b0871572f1F7f0', 'uni/usd'],
    [43_114, '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7', 'avax/usd'],
    [43_114, '0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB', 'eth/usd'],
    [43_114, '0x152b9d0FdC40C096757F570A51E494bd4b943E50', 'btc/usd'],
    [43_114, '0x50b7545627a5162F82A992c33b87aDc75187B218', 'btc/usd'],
  ])(
    'resolves chain %i index token %s to %s',
    (chainId, indexToken, expectedPair) => {
      expect(resolveGmxV1Pair(chainId, indexToken)).toBe(expectedPair);
    },
  );

  it('keeps Avalanche BTC.b and WBTC.e as distinct token metadata with one canonical BTC pair', () => {
    const btcB = getGmxV1IndexTokenConfig(
      43_114,
      '0x152b9d0fdc40c096757f570a51e494bd4b943e50',
    );
    const wbtcE = getGmxV1IndexTokenConfig(
      43_114,
      '0x50b7545627a5162f82a992c33b87adc75187b218',
    );

    expect(btcB).toEqual(
      expect.objectContaining({ tokenSymbol: 'BTC.b', pair: 'btc/usd' }),
    );
    expect(wbtcE).toEqual(
      expect.objectContaining({ tokenSymbol: 'WBTC.e', pair: 'btc/usd' }),
    );
    expect(btcB?.address).not.toBe(wbtcE?.address);
  });

  it('loads the generated Vault snapshot rather than defining a token registry in code', () => {
    expect(Object.keys(gmxV1IndexTokenConfigs[42_161])).not.toHaveLength(0);
    expect(Object.keys(gmxV1IndexTokenConfigs[43_114])).not.toHaveLength(0);
  });

  it.each([
    ['WETH', 'ETH'],
    ['WBTC.e', 'BTC'],
    ['BTC.b', 'BTC'],
    ['LINK', 'LINK'],
  ])('normalizes token symbol %s to canonical asset %s', (symbol, asset) => {
    expect(toGmxV1AssetSymbol(symbol)).toBe(asset);
  });

  it('fails loudly instead of silently writing an empty pair', () => {
    expect(() =>
      resolveGmxV1Pair(
        42_161,
        '0x0000000000000000000000000000000000000001',
      ),
    ).toThrow(
      'Unknown GMX V1 index token 0x0000000000000000000000000000000000000001 on chain 42161. Regenerate the GMX V1 token snapshot before backfilling.',
    );
  });
});
