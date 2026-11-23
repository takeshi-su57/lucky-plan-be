import { describe, expect, it } from '@jest/globals';

import { getRpcTokenInfo, maskRpcUrl, redactRpcSecrets } from './rpc-providers';

const TOKEN = 'AkmDabcdefghijklmnopqrstuvwx9Q2';

describe('rpc-providers', () => {
  it('fingerprints the same token identically across chains', () => {
    const base = getRpcTokenInfo(`https://lb.drpc.live/base/${TOKEN}`);
    const arb = getRpcTokenInfo(`https://lb.drpc.live/arbitrum/${TOKEN}`);

    expect(base?.tokenId).toHaveLength(12);
    expect(base?.tokenId).toBe(arb?.tokenId);
    expect(base?.tokenHint).toBe('AkmD…x9Q2');
    expect(
      getRpcTokenInfo(`https://base-mainnet.g.alchemy.com/v2/${TOKEN}`)
        ?.tokenId,
    ).toBe(base?.tokenId);
  });

  it('returns null for public URLs without a key', () => {
    expect(getRpcTokenInfo('https://arb1.arbitrum.io/rpc')).toBeNull();
    expect(getRpcTokenInfo('not a url')).toBeNull();
  });

  it('masks keys in URLs and free text', () => {
    expect(maskRpcUrl(`https://lb.drpc.live/base/${TOKEN}`)).toBe(
      'https://lb.drpc.live/base/AkmD…x9Q2',
    );
    expect(
      redactRpcSecrets(`URL: https://lb.drpc.live/base/${TOKEN} failed`),
    ).toBe('URL: https://lb.drpc.live/base/AkmD…x9Q2 failed');
  });
});
