import { BotMode } from 'generated/prisma/client';

export type NumericRangeInput = {
  min: number;
  max: number;
  gap: number;
};

export type ValueRange = {
  min: number;
  max: number;
};

/** A group is one grid value. Values inside it are alternatives (OR). */
export type RangeGroup = {
  ranges: ValueRange[];
};

export type SimulationParameterGridInput = {
  direction: BotMode;
  trade: RangeGroup[];
  r2: RangeGroup[];
  slope: RangeGroup[];
  collateral: RangeGroup[];
  size?: RangeGroup[];
  leverage: RangeGroup[];
  leaderExecutionCollateral: RangeGroup[];
  leaderExecutionSize: RangeGroup[];
  leaderExecutionLeverage: RangeGroup[];
  followerRiskSize: RangeGroup[];
  followerRiskCollateral: RangeGroup[];
  score: RangeGroup[];
};

export type SimulationParameterCombination = {
  direction: BotMode;
  trade: ValueRange[];
  r2: ValueRange[];
  slope: ValueRange[];
  collateral: ValueRange[];
  size: ValueRange[];
  leverage: ValueRange[];
  leaderExecutionCollateral: ValueRange[];
  leaderExecutionSize: ValueRange[];
  leaderExecutionLeverage: ValueRange[];
  followerRiskSize: ValueRange[];
  followerRiskCollateral: ValueRange[];
  score: ValueRange[];
};

function roundRangeValue(value: number) {
  return Number(value.toFixed(10));
}

export function expandRangeValues(range: NumericRangeInput) {
  const values: number[] = [];
  const normalizedGap = roundRangeValue(range.gap);

  if (normalizedGap <= 0) {
    throw new Error('Range gap must be greater than 0');
  }

  for (
    let current = roundRangeValue(range.min);
    current <= roundRangeValue(range.max);
    current = roundRangeValue(current + normalizedGap)
  ) {
    values.push(roundRangeValue(current));
  }

  return values;
}

export function normalizeAbsoluteSlopeBounds(bounds: ValueRange) {
  return {
    minSlope: Math.abs(bounds.min),
    maxSlope: Math.abs(bounds.max),
  };
}

export function getDirectionalSlopeBounds(
  direction: BotMode,
  bounds: ValueRange,
) {
  const normalized = normalizeAbsoluteSlopeBounds(bounds);

  if (direction === BotMode.Reversed) {
    return {
      minSlope: -normalized.maxSlope,
      maxSlope: -normalized.minSlope,
    };
  }

  return normalized;
}

export function getDirectionalSlopeRanges(
  direction: BotMode,
  ranges: ValueRange[],
) {
  return ranges.map((range) => {
    const normalized = normalizeAbsoluteSlopeBounds(range);

    if (direction === BotMode.Reversed) {
      return {
        min: -normalized.maxSlope,
        max: -normalized.minSlope,
      };
    }

    return {
      min: normalized.minSlope,
      max: normalized.maxSlope,
    };
  });
}

export function getDirectionalSlopeRange(
  direction: BotMode,
  range: ValueRange,
) {
  return getDirectionalSlopeRanges(direction, [range])[0];
}

export function valueMatchesRange(value: number, range: ValueRange) {
  return value >= range.min && value <= range.max;
}

export function valueMatchesAnyRange(value: number, ranges: ValueRange[]) {
  return ranges.some((range) => value >= range.min && value <= range.max);
}

export function getMinimumRangeMin(ranges: ValueRange[]) {
  return Math.min(...ranges.map((range) => range.min));
}

export function getRangeEnvelope(ranges: ValueRange[]): ValueRange {
  return {
    min: Math.min(...ranges.map((range) => range.min)),
    max: Math.max(...ranges.map((range) => range.max)),
  };
}

export function buildValueRangePairs(
  minRange: NumericRangeInput,
  maxRange: NumericRangeInput,
) {
  const pairs: ValueRange[] = [];

  for (const min of expandRangeValues(minRange)) {
    for (const max of expandRangeValues(maxRange)) {
      if (min > max) {
        continue;
      }

      pairs.push({ min, max });
    }
  }

  return pairs;
}

export function buildSimulationParameterGrid(
  input: SimulationParameterGridInput,
) {
  const combinations: SimulationParameterCombination[] = [];

  for (const trade of input.trade) {
    for (const r2 of input.r2) {
      for (const slope of input.slope) {
        const normalizedSlope = slope.ranges.map(normalizeAbsoluteSlopeBounds);

        for (const collateral of input.collateral) {
          for (const size of input.size ?? [
            { ranges: [{ min: 0, max: 1000000000 }] },
          ]) {
            for (const leverage of input.leverage) {
              for (const leaderExecutionCollateral of input.leaderExecutionCollateral) {
                for (const leaderExecutionSize of input.leaderExecutionSize) {
                  for (const leaderExecutionLeverage of input.leaderExecutionLeverage) {
                    for (const followerRiskSize of input.followerRiskSize) {
                      for (const followerRiskCollateral of input.followerRiskCollateral) {
                        for (const score of input.score) {
                          combinations.push({
                            direction: input.direction,
                            trade: trade.ranges.map((range) => ({ ...range })),
                            r2: r2.ranges.map((range) => ({ ...range })),
                            slope: normalizedSlope.map((range) => ({
                              min: range.minSlope,
                              max: range.maxSlope,
                            })),
                            collateral: collateral.ranges.map((range) => ({
                              ...range,
                            })),
                            size: size.ranges.map((range) => ({ ...range })),
                            leverage: leverage.ranges.map((range) => ({
                              ...range,
                            })),
                            leaderExecutionCollateral:
                              leaderExecutionCollateral.ranges.map((range) => ({
                                ...range,
                              })),
                            leaderExecutionSize: leaderExecutionSize.ranges.map(
                              (range) => ({ ...range }),
                            ),
                            leaderExecutionLeverage:
                              leaderExecutionLeverage.ranges.map((range) => ({
                                ...range,
                              })),
                            followerRiskSize: followerRiskSize.ranges.map(
                              (range) => ({ ...range }),
                            ),
                            followerRiskCollateral:
                              followerRiskCollateral.ranges.map((range) => ({
                                ...range,
                              })),
                            score: score.ranges.map((range) => ({ ...range })),
                          });
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  return combinations;
}
