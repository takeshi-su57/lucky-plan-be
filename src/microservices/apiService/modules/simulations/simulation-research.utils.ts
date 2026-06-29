import { BotMode } from 'generated/prisma/client';

export type NumericRangeInput = {
  min: number;
  max: number;
  gap: number;
};

export type SimulationParameterGridInput = {
  direction: BotMode;
  minTrades: NumericRangeInput;
  maxTrades: NumericRangeInput;
  minR2: NumericRangeInput;
  maxR2: NumericRangeInput;
  minSlopeAbs: NumericRangeInput;
  maxSlopeAbs: NumericRangeInput;
  maxLeverage: NumericRangeInput;
};

export type SimulationParameterCombination = {
  direction: BotMode;
  minTrades: number;
  maxTrades: number;
  minR2: number;
  maxR2: number;
  minSlope: number;
  maxSlope: number;
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

export function normalizeAbsoluteSlopeBounds(bounds: {
  min: number;
  max: number;
}) {
  return {
    minSlope: Math.abs(bounds.min),
    maxSlope: Math.abs(bounds.max),
  };
}

export function getDirectionalSlopeBounds(
  direction: BotMode,
  bounds: { min: number; max: number },
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

export function buildSimulationParameterGrid(
  input: SimulationParameterGridInput,
) {
  const combinations: SimulationParameterCombination[] = [];

  for (const minTrades of expandRangeValues(input.minTrades)) {
    for (const maxTrades of expandRangeValues(input.maxTrades)) {
      if (minTrades > maxTrades) {
        continue;
      }

      for (const minR2 of expandRangeValues(input.minR2)) {
        for (const maxR2 of expandRangeValues(input.maxR2)) {
          if (minR2 > maxR2) {
            continue;
          }

          for (const minSlopeAbs of expandRangeValues(input.minSlopeAbs)) {
            for (const maxSlopeAbs of expandRangeValues(input.maxSlopeAbs)) {
              const { minSlope, maxSlope } = normalizeAbsoluteSlopeBounds({
                min: minSlopeAbs,
                max: maxSlopeAbs,
              });

              if (minSlope > maxSlope) {
                continue;
              }

              for (const maxLeverage of expandRangeValues(input.maxLeverage)) {
                combinations.push({
                  direction: input.direction,
                  minTrades,
                  maxTrades,
                  minR2,
                  maxR2,
                  minSlope,
                  maxSlope,
                  maxLeverage,
                });
              }
            }
          }
        }
      }
    }
  }

  return combinations;
}
