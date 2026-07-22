import { BotMode } from 'generated/prisma/enums';
import {
  PerpTradeHistory,
  PerpTradeHistoryOperation,
  PerpTradePosition,
} from '../trade-histories/entities/event-logs.entity';

export type SimulationExecutionBot = {
  mode: BotMode;
  ratio: number;
  minCollateral: number;
  maxCollateral: number;
  minSize: number;
  maxSize: number;
  minLeverage: number;
  maxLeverage: number;
  leaderExecutionCollateral?: unknown;
  leaderExecutionSize?: unknown;
  leaderExecutionLeverage?: unknown;
  followerRiskSize: unknown;
  followerRiskCollateral: unknown;
};

export type FollowerPositionSizing = {
  sizeUsd: number;
  collateralUsd: number;
  leverage: number;
  notionalScale: number;
  collateralScale: number;
};

function inRange(value: number, min: number, max: number) {
  return Number.isFinite(value) && value >= min && value <= max;
}

function inAnyRange(
  value: number,
  ranges: Array<{ min: number; max: number }>,
) {
  return ranges.some((range) => inRange(value, range.min, range.max));
}

function normalizeRanges(value: unknown): Array<{ min: number; max: number }> {
  if (!Array.isArray(value)) return [];

  return value.filter(
    (range): range is { min: number; max: number } =>
      typeof range === 'object' &&
      range !== null &&
      typeof (range as { min?: unknown }).min === 'number' &&
      typeof (range as { max?: unknown }).max === 'number',
  );
}

function getHistoryPnlUsd(history: PerpTradeHistory) {
  return history.operation === PerpTradeHistoryOperation.PNL_WITHDRAW
    ? history.usdPnl * history.collateralUsdPrice
    : history.usdPnl;
}

export function isLeaderPositionEligible(
  opening: Pick<PerpTradeHistory, 'sizeInUsd' | 'collateralInUsd' | 'leverage'>,
  bot: SimulationExecutionBot,
) {
  const sizeRanges = normalizeRanges(bot.leaderExecutionSize);
  const collateralRanges = normalizeRanges(bot.leaderExecutionCollateral);
  const leverageRanges = normalizeRanges(bot.leaderExecutionLeverage);

  return (
    (sizeRanges.length > 0
      ? inAnyRange(opening.sizeInUsd, sizeRanges)
      : inRange(opening.sizeInUsd, bot.minSize, bot.maxSize)) &&
    (collateralRanges.length > 0
      ? inAnyRange(opening.collateralInUsd, collateralRanges)
      : inRange(
          opening.collateralInUsd,
          bot.minCollateral,
          bot.maxCollateral,
        )) &&
    (leverageRanges.length > 0
      ? inAnyRange(opening.leverage, leverageRanges)
      : inRange(opening.leverage, bot.minLeverage, bot.maxLeverage))
  );
}

export function calculateFollowerPositionSizing(
  opening: Pick<PerpTradeHistory, 'sizeInUsd' | 'collateralInUsd' | 'leverage'>,
  bot: SimulationExecutionBot,
): FollowerPositionSizing | null {
  if (!isLeaderPositionEligible(opening, bot) || opening.sizeInUsd <= 0) {
    return null;
  }

  const sizeUsd = opening.sizeInUsd * bot.ratio;
  const collateralUsd = opening.collateralInUsd * bot.ratio;
  const followerRiskSize = normalizeRanges(bot.followerRiskSize);
  const followerRiskCollateral = normalizeRanges(bot.followerRiskCollateral);

  if (
    !inAnyRange(sizeUsd, followerRiskSize) ||
    !inAnyRange(collateralUsd, followerRiskCollateral)
  ) {
    return null;
  }

  return {
    sizeUsd,
    collateralUsd,
    leverage: opening.leverage,
    notionalScale: bot.ratio,
    collateralScale: bot.ratio,
  };
}

export function simulateFollowerPosition(
  histories: PerpTradeHistory[],
  bot: SimulationExecutionBot,
) {
  const opening = histories.find(
    (history) => history.operation === PerpTradeHistoryOperation.OPEN,
  );
  if (!opening) return null;

  const sizing = calculateFollowerPositionSizing(opening, bot);
  if (!sizing) return null;

  const directionMultiplier = bot.mode === BotMode.Reversed ? -1 : 1;
  let leaderPnl = 0;
  let followerPnl = 0;
  const simulatedHistories = histories.map((history) => {
    const isPnlWithdraw =
      history.operation === PerpTradeHistoryOperation.PNL_WITHDRAW;
    const followerUsdFee =
      history.usdFee !== 0
        ? Math.min(-0.5, history.usdFee * sizing.notionalScale)
        : 0;
    const followerUsdBasePnl =
      history.usdBasePnl * directionMultiplier * sizing.notionalScale;
    // GNS records positive PnL withdrawals in collateral units. Preserve the
    // event as a cash flow so the position ledger reconciles, while keeping
    // its position state at zero as supplied by the source event.
    const followerUsdPnl = isPnlWithdraw
      ? history.usdPnl * directionMultiplier * sizing.notionalScale
      : followerUsdBasePnl + followerUsdFee;
    const follower = {
      ...history,
      id: -history.id,
      usdPnl: followerUsdPnl,
      usdBasePnl: followerUsdBasePnl,
      usdFee: followerUsdFee,
      sizeInUsd: history.sizeInUsd * sizing.notionalScale,
      collateralInUsd: history.collateralInUsd * sizing.collateralScale,
      collateralDeltaUsd: history.collateralDeltaUsd * sizing.collateralScale,
      sizeDeltaUsd: history.sizeDeltaUsd * sizing.notionalScale,
      leverage: history.leverage,
      isLong: bot.mode === BotMode.Reversed ? !history.isLong : history.isLong,
    };

    leaderPnl += getHistoryPnlUsd(history);
    followerPnl += isPnlWithdraw
      ? follower.usdPnl * follower.collateralUsdPrice
      : follower.usdPnl;
    return { leader: history, follower };
  });

  return { histories: simulatedHistories, leaderPnl, followerPnl, sizing };
}

export function simulateFollowerPositions(
  positions: PerpTradePosition[],
  bot: SimulationExecutionBot,
) {
  const results: NonNullable<ReturnType<typeof simulateFollowerPosition>>[] =
    [];
  const ordered = [...positions].sort((left, right) => {
    const leftTime = left.histories[0]?.date?.getTime() ?? 0;
    const rightTime = right.histories[0]?.date?.getTime() ?? 0;
    return leftTime - rightTime;
  });

  for (const position of ordered) {
    const opening = position.histories.find(
      (history) => history.operation === PerpTradeHistoryOperation.OPEN,
    );
    if (!opening) continue;

    const simulated = simulateFollowerPosition(position.histories, bot);
    if (!simulated) continue;

    results.push(simulated);
  }

  return results;
}
