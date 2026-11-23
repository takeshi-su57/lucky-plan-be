export type BlockRange = {
  fromBlock: bigint;
  toBlock: bigint;
};

export type AggressiveRangeQueueSnapshot = {
  fromBlock: number;
  endBlock: number;
  /** Highest block such that every block up to it has been processed. */
  checkpointBlock: number;
  /** Next block that has never been handed to a worker. */
  cursorBlock: number;
  retryRanges: number;
  inFlightRanges: number;
  completedAheadRanges: number;
  completedBlocks: number;
  totalBlocks: number;
};

/** Safety cap on a single getLogs span, whatever an endpoint claims. */
export const MAX_RANGE_SPAN = 100_000n;

const rangeSize = (range: BlockRange) => range.toBlock - range.fromBlock + 1n;

/**
 * Hands out block ranges to workers that each have their own max span, and
 * tracks the contiguous checkpoint. Ranges are produced lazily from a cursor,
 * so a 160M-block backfill does not allocate millions of task objects.
 *
 * Failed ranges go to a retry list ordered by fromBlock. That list is served
 * first, so the checkpoint keeps advancing. Ranges that are too dense are
 * split in half instead of being retried at the same size forever.
 */
export class AggressiveRangeQueue {
  private cursor: bigint;
  private readonly retry: BlockRange[] = [];
  private readonly inFlight = new Set<BlockRange>();
  /** Completed ranges beyond the checkpoint, keyed by fromBlock. */
  private readonly completedAhead = new Map<bigint, bigint>();
  private checkpoint: bigint;
  private completedBlocks = 0n;

  constructor(
    private readonly fromBlock: bigint,
    private readonly endBlock: bigint,
    private readonly batchSize: bigint,
  ) {
    this.cursor = fromBlock;
    this.checkpoint = fromBlock - 1n;
  }

  get checkpointBlock() {
    return this.checkpoint;
  }

  hasClaimable() {
    return this.retry.length > 0 || this.cursor <= this.endBlock;
  }

  isDone() {
    return !this.hasClaimable() && this.inFlight.size === 0;
  }

  /**
   * Claims the lowest pending range. `maxSpan` is the endpoint's own limit;
   * null means unknown, which uses the default batch size.
   */
  claim(maxSpan: bigint | null): BlockRange | null {
    // An endpoint with a known max range (e.g. a paid key set to 10,000) may
    // take more than the default batch; unknown endpoints get the default.
    const span =
      maxSpan && maxSpan > 0n
        ? maxSpan < MAX_RANGE_SPAN
          ? maxSpan
          : MAX_RANGE_SPAN
        : this.batchSize;

    let range: BlockRange;

    if (this.retry.length > 0) {
      const head = this.retry.shift()!;

      if (rangeSize(head) > span) {
        range = {
          fromBlock: head.fromBlock,
          toBlock: head.fromBlock + span - 1n,
        };
        // The remainder still precedes every other retry range.
        this.retry.unshift({
          fromBlock: range.toBlock + 1n,
          toBlock: head.toBlock,
        });
      } else {
        range = head;
      }
    } else if (this.cursor <= this.endBlock) {
      const toBlock =
        this.cursor + span - 1n < this.endBlock
          ? this.cursor + span - 1n
          : this.endBlock;

      range = { fromBlock: this.cursor, toBlock };
      this.cursor = toBlock + 1n;
    } else {
      return null;
    }

    this.inFlight.add(range);
    return range;
  }

  /** Marks a range done. Returns the new checkpoint when it advanced. */
  complete(range: BlockRange): bigint | null {
    this.inFlight.delete(range);
    this.completedAhead.set(range.fromBlock, range.toBlock);
    this.completedBlocks += rangeSize(range);

    const before = this.checkpoint;

    while (this.completedAhead.has(this.checkpoint + 1n)) {
      const next = this.checkpoint + 1n;
      this.checkpoint = this.completedAhead.get(next)!;
      this.completedAhead.delete(next);
    }

    return this.checkpoint > before ? this.checkpoint : null;
  }

  /** Returns a range for retry, optionally split in two halves. */
  release(range: BlockRange, { split }: { split: boolean }) {
    this.inFlight.delete(range);

    if (split && range.toBlock > range.fromBlock) {
      const middle = range.fromBlock + (range.toBlock - range.fromBlock) / 2n;
      this.insertRetry({ fromBlock: range.fromBlock, toBlock: middle });
      this.insertRetry({ fromBlock: middle + 1n, toBlock: range.toBlock });
    } else {
      this.insertRetry(range);
    }
  }

  snapshot(): AggressiveRangeQueueSnapshot {
    return {
      fromBlock: Number(this.fromBlock),
      endBlock: Number(this.endBlock),
      checkpointBlock: Number(this.checkpoint),
      cursorBlock: Number(this.cursor),
      retryRanges: this.retry.length,
      inFlightRanges: this.inFlight.size,
      completedAheadRanges: this.completedAhead.size,
      completedBlocks: Number(this.completedBlocks),
      totalBlocks: Number(this.endBlock - this.fromBlock + 1n),
    };
  }

  private insertRetry(range: BlockRange) {
    let low = 0;
    let high = this.retry.length;

    while (low < high) {
      const middle = (low + high) >> 1;

      if (this.retry[middle].fromBlock < range.fromBlock) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }

    this.retry.splice(low, 0, range);
  }
}
