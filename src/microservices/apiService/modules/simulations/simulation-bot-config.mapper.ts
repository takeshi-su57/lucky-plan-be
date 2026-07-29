export type PersistedSimulationBotConfiguration = {
  ratio: number;
  leaderExecutionCollateral: unknown;
  leaderExecutionSize: unknown;
  leaderExecutionLeverage: unknown;
  followerRiskSize: unknown;
  followerRiskCollateral: unknown;
  evaluationTradeCount: number;
  evaluationSlope: number;
  evaluationR2: number;
  evaluationCopiedPnlUsd: number;
  evaluationProfitFactor: number;
  evaluationMaxDrawdownUsd: number;
  behavioralFeatures?: unknown;
};

function normalizeRanges(value: unknown) {
  if (!Array.isArray(value)) return [];

  return value.filter(
    (range): range is { min: number; max: number } =>
      typeof range === 'object' &&
      range !== null &&
      typeof (range as { min?: unknown }).min === 'number' &&
      typeof (range as { max?: unknown }).max === 'number',
  );
}

export function mapSimulationBotConfiguration<
  T extends PersistedSimulationBotConfiguration,
>(bot: T) {
  return {
    ...bot,
    leaderExecutionCollateral: normalizeRanges(bot.leaderExecutionCollateral),
    leaderExecutionSize: normalizeRanges(bot.leaderExecutionSize),
    leaderExecutionLeverage: normalizeRanges(bot.leaderExecutionLeverage),
    followerRiskSize: normalizeRanges(bot.followerRiskSize),
    followerRiskCollateral: normalizeRanges(bot.followerRiskCollateral),
    baseRatio: bot.ratio,
    evaluationMetrics: {
      tradeCount: bot.evaluationTradeCount,
      slope: bot.evaluationSlope,
      r2: bot.evaluationR2,
      copiedPnlUsd: bot.evaluationCopiedPnlUsd,
      copiedProfitFactor: bot.evaluationProfitFactor,
      copiedMaxDrawdownUsd: bot.evaluationMaxDrawdownUsd,
    },
    behavioralFeaturesJson:
      bot.behavioralFeatures === null || bot.behavioralFeatures === undefined
        ? null
        : JSON.stringify(bot.behavioralFeatures),
  };
}
