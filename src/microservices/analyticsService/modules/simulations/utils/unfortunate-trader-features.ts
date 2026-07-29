import { Platform } from 'generated/prisma/client';

import {
  PerpTradeHistoryOperation,
  PerpTradePosition,
} from 'src/microservices/apiService/modules/trade-histories/entities/event-logs.entity';

export type RateMetric = {
  value: number | null;
  numerator: number;
  denominator: number;
};

export const BEHAVIORAL_FILTER_KEYS = [
  'negativeActiveDayRate',
  'directionalLossPurity',
  'medianPostLossLeverageRatio',
] as const;

export type BehavioralFilterKey = (typeof BEHAVIORAL_FILTER_KEYS)[number];
export type BehavioralFilterRange = { min: number; max: number | null };
export type BehavioralFilterRanges = Partial<
  Record<BehavioralFilterKey, BehavioralFilterRange[]>
>;

export function validateBehavioralFilterRanges(
  filters: BehavioralFilterRanges,
) {
  const configured = BEHAVIORAL_FILTER_KEYS.filter(
    (key) => (filters[key]?.length ?? 0) > 0,
  );
  if (configured.length > 1) {
    throw new Error(
      'Behavioral research currently supports one filter feature at a time',
    );
  }
  for (const key of configured) {
    (filters[key] ?? []).forEach((range, index) => {
      const name = `behavioralFilters.${key}[${index}]`;
      if (!Number.isFinite(range.min) || range.min < 0) {
        throw new Error(`${name} min must be a non-negative number`);
      }
      if (range.max === null) {
        if (key !== 'medianPostLossLeverageRatio') {
          throw new Error(`${name} max is required for rate filters`);
        }
        return;
      }
      if (!Number.isFinite(range.max) || range.max < range.min) {
        throw new Error(
          `${name} max must be a number greater than or equal to min`,
        );
      }
      if (key !== 'medianPostLossLeverageRatio' && range.max > 1) {
        throw new Error(`${name} max must be less than or equal to 1`);
      }
    });
  }
}

export function buildBehavioralFilterVariants(
  filters: BehavioralFilterRanges,
): BehavioralFilterRanges[] {
  validateBehavioralFilterRanges(filters);
  const configured = BEHAVIORAL_FILTER_KEYS.flatMap((key) => {
    const ranges = filters[key] ?? [];
    return ranges.length ? [{ key, ranges }] : [];
  });
  if (configured.length > 1) {
    throw new Error(
      'Behavioral research currently supports one filter feature at a time',
    );
  }
  if (!configured.length) return [{}];
  const [{ key, ranges }] = configured;
  return ranges.map((range) => ({ [key]: [{ ...range }] }));
}

export type PositionEpisode = {
  market: string;
  side: 'LONG' | 'SHORT';
  openedAt: Date;
  closedAt: Date;
  initialSizeUsd: number;
  peakSizeUsd: number;
  initialCollateralUsd: number;
  peakCollateralUsd: number;
  initialLeverage: number;
  peakLeverage: number;
  grossDirectionalPnlUsd: number;
  explicitCostUsd: number;
  netPnlUsd: number;
};

export type UnfortunateTraderFeaturesV1 = {
  schemaVersion: 1;
  traderAddress: string;
  platform: Platform;
  evaluationStart: Date;
  evaluationEnd: Date;
  sample: {
    closedEpisodeCount: number;
    activeWindowCount: number;
    totalWindowCount: number;
    validPostLossObservationCount: number;
    validWindowTransitionCount: number;
    gapClosedEpisodeCount: number;
  };
  activity: {
    activeWindowRatio: number | null;
    medianEpisodesPerActiveWindow: number | null;
    burstConcentration: number | null;
    maxInactiveWindowStreak: number;
  };
  persistence: {
    directionalLossEpisodeRate: RateMetric;
    negativeActiveDayRate: RateMetric;
    negativeWindowContinuationRate: RateMetric;
    negativeToPositiveRecoveryRate: RateMetric;
    medianRecoveryMagnitudeRatio: number | null;
    p90RecoveryMagnitudeRatio: number | null;
    maxNegativeWindowStreak: number;
  };
  lossComposition: {
    directionalLossPurity: number | null;
    feeDominatedLossRate: RateMetric;
  };
  postLossEscalation: {
    medianSizeRatio: number | null;
    p75SizeRatio: number | null;
    medianCollateralRatio: number | null;
    p75CollateralRatio: number | null;
    medianLeverageRatio: number | null;
    p75LeverageRatio: number | null;
    sizeIncreaseRate: RateMetric;
    collateralIncreaseRate: RateMetric;
    leverageIncreaseRate: RateMetric;
    sizeSpikeRate: RateMetric;
    collateralSpikeRate: RateMetric;
    leverageSpikeRate: RateMetric;
  };
  postLossActivity: {
    medianLatencyHours: number | null;
    medianLatencyRatio: number | null;
    p25LatencyRatio: number | null;
    within1HourRate: RateMetric;
    within6HoursRate: RateMetric;
    within24HoursRate: RateMetric;
    within72HoursRate: RateMetric;
    noTradeWithin72HoursRate: RateMetric;
  };
  repeatedMistakes: {
    sameMarketReentryRate: RateMetric;
    sameDirectionReentryRate: RateMetric;
    sameSetupReentryRate: RateMetric;
    repeatedSameSetupLossRate: RateMetric;
  };
  positionManagement: {
    loserHoldDurationRatio: number | null;
    medianLoserHoldDurationHours: number | null;
    medianWinnerHoldDurationHours: number | null;
    liquidationEpisodeRate: RateMetric;
  };
  instability: {
    sizeRobustDispersion: number | null;
    collateralRobustDispersion: number | null;
    leverageRobustDispersion: number | null;
    sizeTailRatio: number | null;
    collateralTailRatio: number | null;
    leverageTailRatio: number | null;
    sizeJumpRate: RateMetric;
    collateralJumpRate: RateMetric;
    leverageJumpRate: RateMetric;
  };
  exposure: {
    medianInitialSizeUsd: number | null;
    p75InitialSizeUsd: number | null;
    p90InitialSizeUsd: number | null;
    medianInitialCollateralUsd: number | null;
    p75InitialCollateralUsd: number | null;
    p90InitialCollateralUsd: number | null;
    medianInitialLeverage: number | null;
    p75InitialLeverage: number | null;
    p90InitialLeverage: number | null;
    medianPeakSizeUsd: number | null;
    p90PeakSizeUsd: number | null;
    medianPeakCollateralUsd: number | null;
    p90PeakCollateralUsd: number | null;
    medianPeakLeverage: number | null;
    p90PeakLeverage: number | null;
  };
};

export function getBehavioralFilterValue(
  features: UnfortunateTraderFeaturesV1,
  key: BehavioralFilterKey,
): number | null {
  const values: Record<BehavioralFilterKey, number | null> = {
    negativeActiveDayRate: features.persistence.negativeActiveDayRate.value,
    directionalLossPurity: features.lossComposition.directionalLossPurity,
    medianPostLossLeverageRatio:
      features.postLossEscalation.medianLeverageRatio,
  };
  return values[key];
}

export function findBehavioralFilterRejection(
  features: UnfortunateTraderFeaturesV1,
  filters: BehavioralFilterRanges,
) {
  for (const key of BEHAVIORAL_FILTER_KEYS) {
    const ranges = filters[key];
    if (!ranges?.length) continue;
    const value = getBehavioralFilterValue(features, key);
    if (value === null) return `BEHAVIORAL_INSUFFICIENT_DATA:${key}`;
    if (
      !ranges.some(
        (range) =>
          value >= range.min && (range.max === null || value <= range.max),
      )
    ) {
      return `BEHAVIORAL_OUT_OF_RANGE:${key}`;
    }
  }
  return undefined;
}

const DAILY_WINDOW_MS = 24 * 60 * 60 * 1000;
const MIN_DISTRIBUTION = 5;
const MIN_POST_LOSS = 3;
const MIN_TRANSITIONS = 3;

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function median(values: number[]) {
  return percentile(values, 0.5);
}
function distribution(values: number[], p: number) {
  return values.length >= MIN_DISTRIBUTION ? percentile(values, p) : null;
}
function postLossDistribution(values: number[], p: number) {
  return values.length >= MIN_POST_LOSS ? percentile(values, p) : null;
}
function rate(numerator: number, denominator: number, minimum = 1): RateMetric {
  return {
    numerator,
    denominator,
    value: denominator >= minimum ? numerator / denominator : null,
  };
}
function ratio(numerator: number | null, denominator: number | null) {
  return numerator !== null && denominator !== null && denominator > 0
    ? numerator / denominator
    : null;
}
function maxStreak(values: boolean[]) {
  let max = 0,
    current = 0;
  for (const value of values) {
    current = value ? current + 1 : 0;
    max = Math.max(max, current);
  }
  return max;
}

/** Converts the existing event-log position lifecycle into a completed V1 episode. */
export function positionToEpisode(
  position: PerpTradePosition,
): PositionEpisode | null {
  const histories = [...position.histories].sort(
    (a, b) => a.date.getTime() - b.date.getTime(),
  );
  const opened = histories[0];
  const closed = histories.at(-1);
  if (
    !opened ||
    !closed ||
    opened.operation !== PerpTradeHistoryOperation.OPEN ||
    closed.operation !== PerpTradeHistoryOperation.CLOSE
  )
    return null;
  const explicitCostUsd = histories.reduce(
    (total, item) => total + Math.abs(item.usdFee || 0),
    0,
  );
  const normalizePnl = (item: (typeof histories)[number]) =>
    item.platform === Platform.GNS &&
    item.operation === PerpTradeHistoryOperation.PNL_WITHDRAW
      ? (item.usdPnl || 0) * (item.collateralUsdPrice || 0)
      : item.usdPnl || 0;
  const netPnlUsd = histories.reduce(
    (total, item) => total + normalizePnl(item),
    0,
  );
  return {
    market: opened.pair,
    side: opened.isLong ? 'LONG' : 'SHORT',
    openedAt: opened.date,
    closedAt: closed.date,
    initialSizeUsd: Math.abs(opened.sizeInUsd || 0),
    peakSizeUsd: Math.max(
      0,
      ...histories.map((item) => Math.abs(item.sizeInUsd || 0)),
    ),
    initialCollateralUsd: Math.abs(opened.collateralInUsd || 0),
    peakCollateralUsd: Math.max(
      0,
      ...histories.map((item) => Math.abs(item.collateralInUsd || 0)),
    ),
    initialLeverage: Math.abs(opened.leverage || 0),
    peakLeverage: Math.max(
      0,
      ...histories.map((item) => Math.abs(item.leverage || 0)),
    ),
    // Existing parsers record fees in usdFee and net realized PnL in usdPnl.
    grossDirectionalPnlUsd: histories.reduce(
      (total, item) => total + normalizePnl(item) - (item.usdFee || 0),
      0,
    ),
    explicitCostUsd,
    netPnlUsd,
  };
}

export function calculateUnfortunateTraderFeaturesV1(input: {
  traderAddress: string;
  platform: Platform;
  evaluationStart: Date;
  evaluationEnd: Date;
  episodes: PositionEpisode[];
  postLossSpikeFactor?: number;
  riskJumpFactor?: number;
}): UnfortunateTraderFeaturesV1 {
  const spike = input.postLossSpikeFactor ?? 1.5;
  const jump = input.riskJumpFactor ?? 2;
  const episodes = [...input.episodes]
    .filter(
      (item) =>
        item.closedAt >= input.evaluationStart &&
        item.closedAt < input.evaluationEnd,
    )
    .sort((a, b) => a.openedAt.getTime() - b.openedAt.getTime());
  const schedules: Array<{
    start: number;
    end: number;
    episodes: PositionEpisode[];
  }> = [];
  for (
    let start = input.evaluationStart.getTime();
    start < input.evaluationEnd.getTime();
    start += DAILY_WINDOW_MS
  )
    schedules.push({
      start,
      end: Math.min(start + DAILY_WINDOW_MS, input.evaluationEnd.getTime()),
      episodes: [],
    });
  for (const episode of episodes) {
    const closed = episode.closedAt.getTime();
    const window = schedules.find(
      (item) => closed >= item.start && closed < item.end,
    );
    if (window) window.episodes.push(episode);
  }
  const active = schedules.filter((item) => item.episodes.length > 0);
  const scheduledEpisodeCount = schedules.reduce(
    (total, item) => total + item.episodes.length,
    0,
  );
  const pnl = (window: { episodes: PositionEpisode[] }) =>
    window.episodes.reduce(
      (total, item) => total + item.grossDirectionalPnlUsd,
      0,
    );
  const activePnl = active.map(pnl);
  const negative = activePnl.map((value) => value < 0);
  const scheduledNegative = schedules.map(
    (window) => window.episodes.length > 0 && pnl(window) < 0,
  );
  let continuations = 0,
    recoveries = 0,
    transitions = 0;
  const recoveryMagnitudes: number[] = [];
  for (let i = 0; i < schedules.length - 1; i++) {
    const current = schedules[i],
      next = schedules[i + 1];
    if (!current.episodes.length || !next.episodes.length || pnl(current) >= 0)
      continue;
    transitions++;
    if (pnl(next) < 0) continuations++;
    else if (pnl(next) > 0) {
      recoveries++;
      recoveryMagnitudes.push(pnl(next) / Math.abs(pnl(current)));
    }
  }
  type Observation = {
    loss: PositionEpisode;
    next: PositionEpisode;
    size: number;
    collateral: number;
    leverage: number;
    latency: number;
    latencyRatio: number | null;
  };
  type Reentry = {
    loss: PositionEpisode;
    next: PositionEpisode | null;
    latency: number | null;
  };
  const directionalLosses = episodes.filter(
    (item) => item.grossDirectionalPnlUsd < 0,
  );
  const reentries: Reentry[] = directionalLosses.map((loss) => {
    const next = episodes.find((item) => item.openedAt > loss.closedAt) ?? null;
    const latency = next
      ? (next.openedAt.getTime() - loss.closedAt.getTime()) / 36e5
      : null;
    return {
      loss,
      next: latency !== null && latency <= 72 ? next : null,
      latency: latency !== null && latency <= 72 ? latency : null,
    };
  });
  const validReentries = reentries.filter(
    (item): item is Reentry & { next: PositionEpisode; latency: number } =>
      item.next !== null && item.latency !== null,
  );
  const observations: Observation[] = [];
  for (const reentry of validReentries) {
    const { loss, next, latency } = reentry;
    const baseline = episodes
      .filter((item) => item.closedAt <= loss.openedAt)
      .sort((left, right) => left.closedAt.getTime() - right.closedAt.getTime())
      .slice(-5);
    if (baseline.length < MIN_POST_LOSS) continue;
    const size = ratio(
      next.initialSizeUsd,
      median(baseline.map((item) => item.initialSizeUsd)),
    );
    const collateral = ratio(
      next.initialCollateralUsd,
      median(baseline.map((item) => item.initialCollateralUsd)),
    );
    const leverage = ratio(
      next.initialLeverage,
      median(baseline.map((item) => item.initialLeverage)),
    );
    if (size === null || collateral === null || leverage === null) continue;
    const normalLatencies = baseline
      .slice(0, -1)
      .map(
        (item, previousIndex) =>
          (baseline[previousIndex + 1].openedAt.getTime() -
            item.closedAt.getTime()) /
          36e5,
      )
      .filter((item) => item > 0);
    observations.push({
      loss,
      next,
      size,
      collateral,
      leverage,
      latency,
      latencyRatio: ratio(latency, median(normalLatencies)),
    });
  }
  const valid = observations.length;
  const postRate = (predicate: (value: Observation) => boolean) =>
    rate(observations.filter(predicate).length, valid, MIN_POST_LOSS);
  const economicLosses = episodes.filter((item) => item.netPnlUsd < 0);
  const directionalLossAmount = economicLosses.reduce(
    (total, item) => total + Math.max(-item.grossDirectionalPnlUsd, 0),
    0,
  );
  const costs = economicLosses.reduce(
    (total, item) => total + item.explicitCostUsd,
    0,
  );
  const initialSize = episodes.map((item) => item.initialSizeUsd),
    initialCollateral = episodes.map((item) => item.initialCollateralUsd),
    initialLeverage = episodes.map((item) => item.initialLeverage);
  const robust = (values: number[]) =>
    values.length >= MIN_DISTRIBUTION
      ? ratio(
          (percentile(values, 0.75) ?? 0) - (percentile(values, 0.25) ?? 0),
          median(values),
        )
      : null;
  const tail = (values: number[]) =>
    values.length >= MIN_DISTRIBUTION
      ? ratio(percentile(values, 0.9), median(values))
      : null;
  const jumpRate = (
    field: keyof Pick<
      PositionEpisode,
      'initialSizeUsd' | 'initialCollateralUsd' | 'initialLeverage'
    >,
  ) => {
    let denominator = 0,
      numerator = 0;
    episodes.forEach((episode, index) => {
      const base = episodes
        .slice(Math.max(0, index - 5), index)
        .map((item) => item[field]);
      const baseMedian = median(base);
      if (base.length >= MIN_POST_LOSS && baseMedian && baseMedian > 0) {
        denominator++;
        if (episode[field] / baseMedian >= jump) numerator++;
      }
    });
    return rate(numerator, denominator, MIN_POST_LOSS);
  };
  const duration = (items: PositionEpisode[]) =>
    items.map(
      (item) => (item.closedAt.getTime() - item.openedAt.getTime()) / 36e5,
    );
  const loserDuration = duration(directionalLosses),
    winnerDuration = duration(
      episodes.filter((item) => item.grossDirectionalPnlUsd > 0),
    );
  return {
    schemaVersion: 1,
    traderAddress: input.traderAddress,
    platform: input.platform,
    evaluationStart: input.evaluationStart,
    evaluationEnd: input.evaluationEnd,
    sample: {
      closedEpisodeCount: episodes.length,
      activeWindowCount: active.length,
      totalWindowCount: schedules.length,
      validPostLossObservationCount: valid,
      validWindowTransitionCount: transitions,
      gapClosedEpisodeCount: episodes.length - scheduledEpisodeCount,
    },
    activity: {
      activeWindowRatio: schedules.length
        ? active.length / schedules.length
        : null,
      medianEpisodesPerActiveWindow: active.length
        ? median(active.map((item) => item.episodes.length))
        : null,
      burstConcentration: episodes.length
        ? Math.max(0, ...active.map((item) => item.episodes.length)) /
          episodes.length
        : null,
      maxInactiveWindowStreak: maxStreak(
        schedules.map((item) => !item.episodes.length),
      ),
    },
    persistence: {
      directionalLossEpisodeRate: rate(
        directionalLosses.length,
        episodes.length,
        MIN_DISTRIBUTION,
      ),
      negativeActiveDayRate: rate(
        negative.filter(Boolean).length,
        active.length,
        MIN_TRANSITIONS,
      ),
      negativeWindowContinuationRate: rate(
        continuations,
        transitions,
        MIN_TRANSITIONS,
      ),
      negativeToPositiveRecoveryRate: rate(
        recoveries,
        transitions,
        MIN_TRANSITIONS,
      ),
      medianRecoveryMagnitudeRatio: distribution(recoveryMagnitudes, 0.5),
      p90RecoveryMagnitudeRatio: distribution(recoveryMagnitudes, 0.9),
      maxNegativeWindowStreak: maxStreak(scheduledNegative),
    },
    lossComposition: {
      directionalLossPurity:
        directionalLossAmount + costs > 0
          ? directionalLossAmount / (directionalLossAmount + costs)
          : null,
      feeDominatedLossRate: rate(
        economicLosses.filter((item) => item.grossDirectionalPnlUsd >= 0)
          .length,
        economicLosses.length,
        MIN_DISTRIBUTION,
      ),
    },
    postLossEscalation: {
      medianSizeRatio: postLossDistribution(
        observations.map((item) => item.size),
        0.5,
      ),
      p75SizeRatio: postLossDistribution(
        observations.map((item) => item.size),
        0.75,
      ),
      medianCollateralRatio: postLossDistribution(
        observations.map((item) => item.collateral),
        0.5,
      ),
      p75CollateralRatio: postLossDistribution(
        observations.map((item) => item.collateral),
        0.75,
      ),
      medianLeverageRatio: postLossDistribution(
        observations.map((item) => item.leverage),
        0.5,
      ),
      p75LeverageRatio: postLossDistribution(
        observations.map((item) => item.leverage),
        0.75,
      ),
      sizeIncreaseRate: postRate((item) => item.size > 1),
      collateralIncreaseRate: postRate((item) => item.collateral > 1),
      leverageIncreaseRate: postRate((item) => item.leverage > 1),
      sizeSpikeRate: postRate((item) => item.size >= spike),
      collateralSpikeRate: postRate((item) => item.collateral >= spike),
      leverageSpikeRate: postRate((item) => item.leverage >= spike),
    },
    postLossActivity: {
      medianLatencyHours: postLossDistribution(
        validReentries.map((item) => item.latency),
        0.5,
      ),
      medianLatencyRatio: postLossDistribution(
        observations
          .map((item) => item.latencyRatio)
          .filter((item): item is number => item !== null),
        0.5,
      ),
      p25LatencyRatio: postLossDistribution(
        observations
          .map((item) => item.latencyRatio)
          .filter((item): item is number => item !== null),
        0.25,
      ),
      within1HourRate: rate(
        validReentries.filter((item) => item.latency <= 1).length,
        reentries.length,
      ),
      within6HoursRate: rate(
        validReentries.filter((item) => item.latency > 1 && item.latency <= 6)
          .length,
        reentries.length,
      ),
      within24HoursRate: rate(
        validReentries.filter((item) => item.latency > 6 && item.latency <= 24)
          .length,
        reentries.length,
      ),
      within72HoursRate: rate(
        validReentries.filter((item) => item.latency > 24 && item.latency <= 72)
          .length,
        reentries.length,
      ),
      noTradeWithin72HoursRate: rate(
        reentries.filter((item) => item.next === null).length,
        reentries.length,
      ),
    },
    repeatedMistakes: {
      sameMarketReentryRate: rate(
        validReentries.filter((item) => item.loss.market === item.next.market)
          .length,
        validReentries.length,
        MIN_POST_LOSS,
      ),
      sameDirectionReentryRate: rate(
        validReentries.filter((item) => item.loss.side === item.next.side)
          .length,
        validReentries.length,
        MIN_POST_LOSS,
      ),
      sameSetupReentryRate: rate(
        validReentries.filter(
          (item) =>
            item.loss.market === item.next.market &&
            item.loss.side === item.next.side,
        ).length,
        validReentries.length,
        MIN_POST_LOSS,
      ),
      repeatedSameSetupLossRate: rate(
        validReentries.filter(
          (item) =>
            item.loss.market === item.next.market &&
            item.loss.side === item.next.side &&
            item.next.grossDirectionalPnlUsd < 0,
        ).length,
        validReentries.filter(
          (item) =>
            item.loss.market === item.next.market &&
            item.loss.side === item.next.side,
        ).length,
        MIN_POST_LOSS,
      ),
    },
    positionManagement: {
      loserHoldDurationRatio: ratio(
        distribution(loserDuration, 0.5),
        distribution(winnerDuration, 0.5),
      ),
      medianLoserHoldDurationHours: distribution(loserDuration, 0.5),
      medianWinnerHoldDurationHours: distribution(winnerDuration, 0.5),
      liquidationEpisodeRate: rate(0, 0),
    },
    instability: {
      sizeRobustDispersion: robust(initialSize),
      collateralRobustDispersion: robust(initialCollateral),
      leverageRobustDispersion: robust(initialLeverage),
      sizeTailRatio: tail(initialSize),
      collateralTailRatio: tail(initialCollateral),
      leverageTailRatio: tail(initialLeverage),
      sizeJumpRate: jumpRate('initialSizeUsd'),
      collateralJumpRate: jumpRate('initialCollateralUsd'),
      leverageJumpRate: jumpRate('initialLeverage'),
    },
    exposure: {
      medianInitialSizeUsd: distribution(initialSize, 0.5),
      p75InitialSizeUsd: distribution(initialSize, 0.75),
      p90InitialSizeUsd: distribution(initialSize, 0.9),
      medianInitialCollateralUsd: distribution(initialCollateral, 0.5),
      p75InitialCollateralUsd: distribution(initialCollateral, 0.75),
      p90InitialCollateralUsd: distribution(initialCollateral, 0.9),
      medianInitialLeverage: distribution(initialLeverage, 0.5),
      p75InitialLeverage: distribution(initialLeverage, 0.75),
      p90InitialLeverage: distribution(initialLeverage, 0.9),
      medianPeakSizeUsd: distribution(
        episodes.map((item) => item.peakSizeUsd),
        0.5,
      ),
      p90PeakSizeUsd: distribution(
        episodes.map((item) => item.peakSizeUsd),
        0.9,
      ),
      medianPeakCollateralUsd: distribution(
        episodes.map((item) => item.peakCollateralUsd),
        0.5,
      ),
      p90PeakCollateralUsd: distribution(
        episodes.map((item) => item.peakCollateralUsd),
        0.9,
      ),
      medianPeakLeverage: distribution(
        episodes.map((item) => item.peakLeverage),
        0.5,
      ),
      p90PeakLeverage: distribution(
        episodes.map((item) => item.peakLeverage),
        0.9,
      ),
    },
  };
}
