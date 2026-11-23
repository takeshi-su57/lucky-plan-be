import { describe, expect, it } from '@jest/globals';

import { classifyRpcError } from './rpc-error-classifier';

const httpError = (status: number | undefined, details = '', url = '') =>
  Object.assign(new Error('HTTP request failed.'), {
    shortMessage: 'HTTP request failed.',
    status,
    details,
    message: `HTTP request failed.\n\nStatus: ${status}\nURL: ${url}`,
  });

// Messages taken from the 2026-11-22 analytics logs.
describe('classifyRpcError', () => {
  it.each([
    [
      httpError(400, 'ranges over 100 blocks are not supported on free plan'),
      'range_limit',
      100,
    ],
    [
      new Error(
        'Under the Free tier plan, you can make eth_getLogs requests with up to a 10 block range.',
      ),
      'range_limit',
      10,
    ],
    [
      new Error('block range exceeds limit of 2000 blocks'),
      'range_limit',
      2000,
    ],
    [
      new Error(
        'Log response size exceeded. Maximum allowed number of requested blocks is 1000',
      ),
      'range_limit',
      1000,
    ],
    [new Error('Requested range is over limit of 3000'), 'range_limit', null],
    [
      new Error('HTTP response body exceeded the size limit.'),
      'response_too_large',
      null,
    ],
    [
      new Error('logs matched by query exceeds limit of 10000'),
      'response_too_large',
      null,
    ],
    [httpError(429), 'rate_limited', null],
    [new Error('request limit reached'), 'rate_limited', null],
    [
      httpError(410, '"This endpoint has been discontinued."'),
      'permanent',
      null,
    ],
    [httpError(403), 'permanent', null],
    [
      httpError(401, 'message: API key disabled, reason: tenant disabled'),
      'auth',
      null,
    ],
    [new Error('invalid api key'), 'auth', null],
    // Real responses for a bad key (probed 2026-11-23).
    [
      httpError(403, '{"message":"Your token is invalid or expired","code":4}'),
      'auth',
      null,
    ],
    [httpError(401, '"Must be authenticated!"'), 'auth', null],
    [new Error('Apikey not found'), 'auth', null],
    [new Error("Your ip is not in the key's ip whitelist"), 'auth', null],
    [
      new Error('MEGAETH_MAINNET is not enabled for this app.'),
      'permanent',
      null,
    ],
    [
      new Error('fetch failed | getaddrinfo ENOTFOUND polygon.meowrpc.com'),
      'permanent',
      null,
    ],
    [new Error('Blast API is no longer available.'), 'permanent', null],
    [
      new Error(
        'pruned history unavailable: requested 1, earliest available 2',
      ),
      'permanent',
      null,
    ],
    [new Error('fetch failed'), 'transient', null],
  ])('classifies %s', (error, kind, span) => {
    const result = classifyRpcError(error);
    expect(result.kind).toBe(kind);
    expect(result.suggestedMaxBlockRange).toBe(span);
  });

  it('redacts API keys from messages', () => {
    const result = classifyRpcError(
      httpError(
        400,
        '',
        'https://lb.drpc.live/base/AkmDabcdefghijklmnopqrstuvwxyz123',
      ),
    );

    expect(result.message).not.toContain('abcdefghijklmnopqrstuvwxyz');
    expect(result.message).toContain('https://lb.drpc.live/base/AkmD…z123');
  });
});
