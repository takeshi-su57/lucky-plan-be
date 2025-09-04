import { actionToEvent, eventToAction } from 'src/utils';

export const eventName = 'PositionIncrease';

export type PositionIncreaseEventArgs = {
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
  orderType: bigint;
  increasedAtTime: bigint;
  collateralDeltaAmount: bigint;
  priceImpactUsd?: bigint;
  priceImpactAmount?: bigint;
  pendingPriceImpactUsd?: bigint;
  pendingPriceImpactAmount?: bigint;
  isLong: boolean;
  orderKey: `0x${string}`;
  positionKey: `0x${string}`;
};

export type PositionIncreaseEvent = {
  eventName: typeof eventName;
  args: PositionIncreaseEventArgs;
};

export function parsePositionIncreaseEvent(event: PositionIncreaseEvent) {
  return eventToAction(
    event.eventName,
    event.args.positionKey,
    event.args.account,
    event.args,
  );
}

export const positionIncreaseEventParser = {
  eventName,
  logParser: parsePositionIncreaseEvent,
  actionParser: actionToEvent<PositionIncreaseEventArgs>,
};
