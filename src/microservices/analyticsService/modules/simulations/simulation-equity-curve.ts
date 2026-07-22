export type RealizedEquityPoint = {
  timestamp: string;
  realizedPnlUsd: number;
  equityUsd: number;
};

type CachedFollowerHistory = {
  date?: string | Date;
  usdPnl?: number;
  collateralUsdPrice?: number;
  operation?: string;
};

type CachedSimulationPosition = {
  histories?: Array<{ follower?: CachedFollowerHistory }>;
};

function realizedPnl(history: CachedFollowerHistory) {
  const pnl = history.usdPnl;
  if (typeof pnl !== 'number' || !Number.isFinite(pnl)) return 0;
  return history.operation === 'PNL_WITHDRAW'
    ? pnl * (history.collateralUsdPrice ?? 0)
    : pnl;
}

/** Builds a deterministic, event-time realized-PnL ledger from follower events. */
export function buildRealizedEquityCurve(
  positions: CachedSimulationPosition[],
): RealizedEquityPoint[] {
  const deltas = new Map<number, number>();
  for (const position of positions) {
    for (const item of position.histories ?? []) {
      const history = item.follower;
      if (!history) continue;
      const timestamp = new Date(history.date ?? '').getTime();
      const pnl = realizedPnl(history);
      if (!Number.isFinite(timestamp) || pnl === 0) continue;
      deltas.set(timestamp, (deltas.get(timestamp) ?? 0) + pnl);
    }
  }

  let equityUsd = 0;
  return [...deltas.entries()]
    .sort(([a], [b]) => a - b)
    .map(([timestamp, realizedPnlUsd]) => {
      equityUsd += realizedPnlUsd;
      return {
        timestamp: new Date(timestamp).toISOString(),
        realizedPnlUsd,
        equityUsd,
      };
    });
}

export function mergeRealizedEquityCurves(curves: RealizedEquityPoint[][]) {
  const deltas = new Map<number, number>();
  for (const curve of curves) {
    let previousEquity = 0;
    for (const point of curve) {
      const timestamp = new Date(point.timestamp).getTime();
      const delta = point.equityUsd - previousEquity;
      previousEquity = point.equityUsd;
      if (!Number.isFinite(timestamp) || !Number.isFinite(delta)) continue;
      deltas.set(timestamp, (deltas.get(timestamp) ?? 0) + delta);
    }
  }
  let equityUsd = 0;
  return [...deltas.entries()]
    .sort(([a], [b]) => a - b)
    .map(([timestamp, realizedPnlUsd]) => {
      equityUsd += realizedPnlUsd;
      return {
        timestamp: new Date(timestamp).toISOString(),
        realizedPnlUsd,
        equityUsd,
      };
    });
}
