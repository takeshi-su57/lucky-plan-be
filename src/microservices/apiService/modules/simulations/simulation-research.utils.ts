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

export type SimulationParameterGridInput = {
  direction: BotMode;
  trade: ValueRange[];
  r2: ValueRange[];
  slope: ValueRange[];
  maxLeverage: NumericRangeInput;
};

export type SimulationParameterCombination = {
  direction: BotMode;
  trade: ValueRange;
  r2: ValueRange;
  slope: ValueRange;
  maxLeverage: number;
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

export function getDirectionalSlopeRange(direction: BotMode, range: ValueRange) {
  return getDirectionalSlopeRanges(direction, [range])[0];
}

export function valueMatchesRange(value: number, range: ValueRange) {
  return value >= range.min && value <= range.max;
}

export function valueMatchesAnyRange(value: number, ranges: ValueRange[]) {
  return ranges.some((range) => value >= range.min && value <= range.max);
}

export function getMinimumRangeMin(ranges: ValueRange[]) {
  if (ranges.length === 0) {
    return 0;
  }

  return Math.min(...ranges.map((range) => range.min));
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
        const normalizedSlope = normalizeAbsoluteSlopeBounds(slope);

        for (const maxLeverage of expandRangeValues(input.maxLeverage)) {
          combinations.push({
            direction: input.direction,
            trade: { ...trade },
            r2: { ...r2 },
            slope: {
              min: normalizedSlope.minSlope,
              max: normalizedSlope.maxSlope,
            },
            maxLeverage,
          });
        }
      }
    }
  }

  return combinations;
}
