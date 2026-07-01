import { SimulationTradePosition } from './entities/simulations.entity';

type CacheBackedSimulationBot = {
  leaderPlatform: string;
  openedPositions: number;
  totalPositions: number;
  totalPnl: number;
  maxDuration: number;
  avgDuration: number;
  avgPnl: number;
  avgPositivePnl: number;
  avgNegativePnl: number;
  avgSize: number;
  avgCollateral: number;
  avgPnlPercentageBySize: number;
  avgPnlPercentageByCollateral: number;
  avgLeverage: number;
  cache?: {
    openedPositions: number;
    totalPositions: number;
    totalLeaderPnl: number;
    maxDuration: number;
    avgDuration: number;
    avgPnl: number;
    avgPositivePnl: number;
    avgNegativePnl: number;
    avgSize: number;
    avgCollateral: number;
    avgPnlPercentageBySize: number;
    avgPnlPercentageByCollateral: number;
    avgLeverage: number;
    positionsJson?: string;
  } | null;
};

type CacheBackedSimulationPlan<TBot> = {
  id: number;
  title: string;
  description: string;
  startAt: Date;
  endAt: Date;
  cursor: Date;
  simulationId: number | null;
  openedPositions: number;
  totalPositions: number;
  totalLeaderPnl: number;
  totalFollowerPnl: number;
  simulationBots: TBot[];
  cache?: {
    openedPositions: number;
    totalPositions: number;
    totalLeaderPnl: number;
    totalFollowerPnl: number;
  } | null;
};

export function mapSimulationBotWithCache<T extends CacheBackedSimulationBot>(
  bot: T,
): T {
  if (!bot.cache) {
    return bot;
  }

  return {
    ...bot,
    openedPositions: bot.cache.openedPositions,
    totalPositions: bot.cache.totalPositions,
    totalPnl: bot.cache.totalLeaderPnl,
    maxDuration: bot.cache.maxDuration,
    avgDuration: bot.cache.avgDuration,
    avgPnl: bot.cache.avgPnl,
    avgPositivePnl: bot.cache.avgPositivePnl,
    avgNegativePnl: bot.cache.avgNegativePnl,
    avgSize: bot.cache.avgSize,
    avgCollateral: bot.cache.avgCollateral,
    avgPnlPercentageBySize: bot.cache.avgPnlPercentageBySize,
    avgPnlPercentageByCollateral: bot.cache.avgPnlPercentageByCollateral,
    avgLeverage: bot.cache.avgLeverage,
  };
}

export function mapSimulationBotDetailsWithCache<
  T extends CacheBackedSimulationBot & {
    positions?: SimulationTradePosition[];
  },
>(bot: T): T & { positions: SimulationTradePosition[] } {
  const mappedBot = mapSimulationBotWithCache(bot);

  if (!mappedBot.cache?.positionsJson) {
    return {
      ...mappedBot,
      positions: mappedBot.positions ?? [],
    };
  }

  return {
    ...mappedBot,
    positions: JSON.parse(
      mappedBot.cache.positionsJson,
    ) as SimulationTradePosition[],
  };
}

export function mapSimulationPlanWithCache<
  TBot extends CacheBackedSimulationBot,
  TPlan extends CacheBackedSimulationPlan<TBot>,
>(plan: TPlan): TPlan {
  const simulationBots = plan.simulationBots.map((bot) =>
    mapSimulationBotWithCache(bot),
  ) as TBot[];

  if (!plan.cache) {
    return {
      ...plan,
      simulationBots,
    };
  }

  return {
    ...plan,
    openedPositions: plan.cache.openedPositions,
    totalPositions: plan.cache.totalPositions,
    totalLeaderPnl: plan.cache.totalLeaderPnl,
    totalFollowerPnl: plan.cache.totalFollowerPnl,
    simulationBots,
  };
}
