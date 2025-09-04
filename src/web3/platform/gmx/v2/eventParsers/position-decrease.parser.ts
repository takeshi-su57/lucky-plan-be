import { actionToEvent, eventToAction } from 'src/utils';

export const eventName = 'PositionDecrease';

export type PositionDecreaseEventArgs = {
  account: `0x${string}`;
  market: `0x${string}`;
  collateralToken: `0x${string}`;
  sizeInUsd: bigint;
  sizeInTokens: bigint;
  collateralAmount: bigint;
  borrowingFactor: bigint;
  fundingFeeAmountPerSize: bigint;
  longTokenClaimableFundingAmountPerSize: bigint;
  shortTokenClaimableFundingAmountPerSize: bigint;
  executionPrice: bigint;
  'indexTokenPrice.max': bigint;
  'indexTokenPrice.min': bigint;
  'collateralTokenPrice.max': bigint;
  'collateralTokenPrice.min': bigint;
  sizeDeltaUsd: bigint;
  sizeDeltaInTokens: bigint;
  collateralDeltaAmount: bigint;
  'values.priceImpactDiffUsd': bigint;
  orderType: bigint;
  decreasedAtTime: bigint;
  priceImpactUsd: bigint;
  proportionalPendingImpactUsd?: bigint;
  totalImpactUsd?: bigint;
  basePnlUsd: bigint;
  uncappedBasePnlUsd: bigint;
  isLong: boolean;
  orderKey: `0x${string}`;
  positionKey: `0x${string}`;
};

export type PositionDecreaseEvent = {
  eventName: typeof eventName;
  args: PositionDecreaseEventArgs;
};

export function parsePositionDecreaseEvent(event: PositionDecreaseEvent) {
  return eventToAction(
    event.eventName,
    event.args.positionKey,
    event.args.account,
    event.args,
  );
}

export const positionDecreaseEventParser = {
  eventName,
  logParser: parsePositionDecreaseEvent,
  actionParser: actionToEvent<PositionDecreaseEventArgs>,
};
