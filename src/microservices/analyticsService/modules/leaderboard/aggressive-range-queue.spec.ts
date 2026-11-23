import { describe, expect, it } from '@jest/globals';

import { AggressiveRangeQueue } from './aggressive-range-queue';

describe('AggressiveRangeQueue', () => {
  it('hands out ranges trimmed to each worker span', () => {
    const queue = new AggressiveRangeQueue(1n, 1000n, 400n);

    expect(queue.claim(null)).toEqual({ fromBlock: 1n, toBlock: 400n });
    expect(queue.claim(100n)).toEqual({ fromBlock: 401n, toBlock: 500n });
    // A known larger limit (e.g. a paid key) may exceed the default batch.
    expect(queue.claim(450n)).toEqual({ fromBlock: 501n, toBlock: 950n });
    expect(queue.claim(null)).toEqual({ fromBlock: 951n, toBlock: 1000n });
    expect(queue.claim(null)).toBeNull();
  });

  it('advances the checkpoint only through contiguous completed ranges', () => {
    const queue = new AggressiveRangeQueue(1n, 300n, 100n);
    const a = queue.claim(null)!;
    const b = queue.claim(null)!;
    const c = queue.claim(null)!;

    expect(queue.complete(b)).toBeNull();
    expect(queue.complete(a)).toBe(200n);
    expect(queue.isDone()).toBe(false);
    expect(queue.complete(c)).toBe(300n);
    expect(queue.isDone()).toBe(true);
  });

  it('serves released ranges first and splits them for smaller workers', () => {
    const queue = new AggressiveRangeQueue(1n, 1000n, 400n);
    const first = queue.claim(null)!;
    queue.claim(null);

    queue.release(first, { split: false });

    expect(queue.claim(100n)).toEqual({ fromBlock: 1n, toBlock: 100n });
    expect(queue.claim(null)).toEqual({ fromBlock: 101n, toBlock: 400n });
    expect(queue.claim(null)).toEqual({ fromBlock: 801n, toBlock: 1000n });
  });

  it('splits dense ranges in half', () => {
    const queue = new AggressiveRangeQueue(1n, 400n, 400n);
    const range = queue.claim(null)!;

    queue.release(range, { split: true });

    expect(queue.claim(null)).toEqual({ fromBlock: 1n, toBlock: 200n });
    expect(queue.claim(null)).toEqual({ fromBlock: 201n, toBlock: 400n });
  });
});
