export type CoverageInterval = {
  coveredStartAt: Date;
  coveredEndAt: Date;
};

/** True when the union of completed fragments has no gap in the requested window. */
export function coversRange(
  intervals: CoverageInterval[],
  startedAt: Date,
  endedAt: Date,
) {
  return missingRanges(intervals, startedAt, endedAt).length === 0;
}

/** Returns the portions of a requested window that are not already covered. */
export function missingRanges(
  intervals: CoverageInterval[],
  startedAt: Date,
  endedAt: Date,
): CoverageInterval[] {
  let cursor = startedAt.getTime();
  const missing: CoverageInterval[] = [];
  for (const interval of mergeRanges(intervals)) {
    const start = interval.coveredStartAt.getTime();
    const end = interval.coveredEndAt.getTime();
    if (end <= cursor) continue;
    if (start >= endedAt.getTime()) break;
    if (start > cursor) {
      missing.push({
        coveredStartAt: new Date(cursor),
        coveredEndAt: new Date(Math.min(start, endedAt.getTime())),
      });
    }
    cursor = Math.max(cursor, end);
    if (cursor >= endedAt.getTime()) break;
  }
  if (cursor < endedAt.getTime()) {
    missing.push({ coveredStartAt: new Date(cursor), coveredEndAt: endedAt });
  }
  return missing;
}

/** Coalesces overlapping *and adjacent* fragments into their canonical ranges. */
export function mergeRanges(intervals: CoverageInterval[]): CoverageInterval[] {
  const sorted = intervals
    .filter((item) => item.coveredStartAt < item.coveredEndAt)
    .sort((a, b) => +a.coveredStartAt - +b.coveredStartAt);
  const merged: CoverageInterval[] = [];
  for (const interval of sorted) {
    const previous = merged.at(-1);
    if (!previous || interval.coveredStartAt > previous.coveredEndAt) {
      merged.push({ ...interval });
      continue;
    }
    if (interval.coveredEndAt > previous.coveredEndAt) {
      previous.coveredEndAt = interval.coveredEndAt;
    }
  }
  return merged;
}
