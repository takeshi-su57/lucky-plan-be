import { describe, expect, it } from '@jest/globals';

import { mergeGmxV2Chain, toGmxBaseSymbol } from './gmx-v2-config';
import { resolveGmxMarketPair, unknownGmxMarketPair } from './configs';
import { MarketConfig, Token } from './types';

const USDC = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
const QQQ = '0xfe71D55D0080b6995Ec2C3f48b7702c86e200766';
const ETH = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1';

const curatedUsdc: Token = {
  name: 'USD Coin',
  symbol: 'USDC',
  address: USDC,
  decimals: 6,
  isStable: true,
  imageUrl: 'https://example.com/usdc.png',
};

describe('GMX V2 config generator', () => {
  it('normalises deprecated symbols', () => {
    expect(toGmxBaseSymbol('XAUT (deprecated)')).toBe('XAUT');
    expect(toGmxBaseSymbol('APE_deprecated')).toBe('APE');
    expect(toGmxBaseSymbol('BTC')).toBe('BTC');
  });

  it('adds new markets and tokens, keeps curated entries and skips swap-only', () => {
    const existingMarket = { marketTokenAddress: '0xEXISTING' } as MarketConfig;

    const merged = mergeGmxV2Chain(
      { '0xEXISTING': existingMarket },
      { [USDC.toLowerCase()]: curatedUsdc },
      [
        {
          name: 'OLD',
          marketToken: '0xexisting',
          indexToken: QQQ,
          longToken: ETH,
          shortToken: USDC,
        },
        {
          name: 'QQQ/USD [ETH-USDC]',
          marketToken: '0x1C132E43',
          indexToken: QQQ,
          longToken: ETH,
          shortToken: USDC,
        },
        {
          name: 'SWAP-ONLY [ETH-USDC]',
          marketToken: '0xSWAP',
          indexToken: '0x0000000000000000000000000000000000000000',
          longToken: ETH,
          shortToken: USDC,
        },
        {
          name: 'MISSING/USD',
          marketToken: '0xMISSING',
          indexToken: '0x00000000000000000000000000000000000000ff',
          longToken: ETH,
          shortToken: USDC,
        },
      ],
      [
        { symbol: 'USDC', address: USDC, decimals: 6 },
        { symbol: 'ETH', address: ETH, decimals: 18 },
        { symbol: 'QQQ', address: QQQ, decimals: 18, synthetic: true },
      ],
    );

    expect(merged.markets['0xEXISTING']).toBe(existingMarket);
    expect(merged.tokens[USDC.toLowerCase()]).toBe(curatedUsdc);
    expect(merged.addedTokens).toEqual(['ETH', 'QQQ']);
    expect(merged.addedMarkets).toEqual(['QQQ/USD [ETH-USDC]']);
    expect(merged.skippedMarkets).toEqual(['MISSING/USD (unknown token)']);
    expect(merged.markets['0x1C132E43'].indexToken).toMatchObject({
      symbol: 'QQQ',
      decimals: 18,
      isSynthetic: true,
    });
    expect(merged.markets['0x1C132E43'].shortToken).toBe(curatedUsdc);
  });

  it('names known markets and gives unknown ones a placeholder', () => {
    expect(
      resolveGmxMarketPair(42161, '0x1C132E43029efCd57435eE79ceA98006C6227A6f'),
    ).not.toContain('unknown');
    expect(
      resolveGmxMarketPair(42161, '0x00000000000000000000000000000000000000AB'),
    ).toBe(unknownGmxMarketPair('0x00000000000000000000000000000000000000ab'));
  });
});
