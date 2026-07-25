/** Small pure helpers used by the analytics report generator. */
export type PositionAggregate = {
  positionCount: number;
  leaderPnlUsd: number;
  followerPnlUsd: number;
  wins: number;
  grossProfitUsd: number;
  grossLossUsd: number;
};

export function* iterateCachedPositions(
  value: string,
  warnings: string[],
  botId: number,
): Generator<any> {
  try {
    let cursor = 0;
    while (/\s/.test(value[cursor] ?? '')) cursor += 1;
    if (value[cursor] !== '[') throw new Error('Expected an array');
    cursor += 1;
    while (cursor < value.length) {
      while (/\s|,/.test(value[cursor] ?? '')) cursor += 1;
      if (value[cursor] === ']') return;
      const start = cursor;
      let depth = 0;
      let quoted = false;
      let escaped = false;
      for (; cursor < value.length; cursor += 1) {
        const character = value[cursor];
        if (quoted) {
          if (escaped) escaped = false;
          else if (character === '\\') escaped = true;
          else if (character === '"') quoted = false;
          continue;
        }
        if (character === '"') quoted = true;
        else if (character === '{' || character === '[') depth += 1;
        else if (character === '}' || character === ']') {
          depth -= 1;
          if (depth === 0) {
            cursor += 1;
            yield JSON.parse(value.slice(start, cursor));
            break;
          }
        }
      }
      if (depth !== 0 || quoted) throw new Error('Unterminated position');
    }
    throw new Error('Unterminated array');
  } catch {
    warnings.push(
      `Bot ${botId} has unreadable cached positions and was excluded from the report.`,
    );
  }
}

export function parseCachedEquity(value: string | undefined): any[] {
  try {
    const parsed = JSON.parse(value ?? '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Cached report rows must originate from an actual simulated follower event. */
export function isExecutedFollowerPosition(position: any) {
  return (
    Array.isArray(position?.histories) &&
    position.histories.some((history: any) => history?.follower != null)
  );
}

function finiteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function normalizeExecutedPosition(
  position: any,
  context: Record<string, unknown>,
  index: number,
) {
  return {
    ...context,
    positionIndex: index + 1,
    positionId: position.id ?? position.key ?? position.positionId ?? null,
    openedAt:
      position.openedAt ?? position.openedDate ?? position.startedAt ?? null,
    closedAt:
      position.closedAt ?? position.closedDate ?? position.stoppedAt ?? null,
    pair: position.pair ?? position.market ?? position.symbol ?? null,
    side: position.side ?? position.direction ?? null,
    leaderPnlUsd: finiteNumber(position.leaderPnl),
    followerPnlUsd: finiteNumber(position.followerPnl),
    collateralUsd: finiteNumber(position.collateral ?? position.collateralUsd),
    sizeUsd: finiteNumber(position.size ?? position.sizeUsd),
    leverage: finiteNumber(position.leverage),
  };
}

export function createPositionAggregate(): PositionAggregate {
  return {
    positionCount: 0,
    leaderPnlUsd: 0,
    followerPnlUsd: 0,
    wins: 0,
    grossProfitUsd: 0,
    grossLossUsd: 0,
  };
}

export function addPositionToAggregate(
  aggregate: PositionAggregate,
  position: any,
) {
  aggregate.positionCount += 1;
  aggregate.leaderPnlUsd += position.leaderPnlUsd ?? 0;
  const pnl = position.followerPnlUsd ?? 0;
  aggregate.followerPnlUsd += pnl;
  if (pnl > 0) {
    aggregate.wins += 1;
    aggregate.grossProfitUsd += pnl;
  } else if (pnl < 0) {
    aggregate.grossLossUsd += Math.abs(pnl);
  }
}

export function summarizePositionAggregate(aggregate: PositionAggregate) {
  return {
    ...aggregate,
    winRate: aggregate.positionCount
      ? aggregate.wins / aggregate.positionCount
      : 0,
    profitFactor: aggregate.grossLossUsd
      ? aggregate.grossProfitUsd / aggregate.grossLossUsd
      : null,
  };
}
