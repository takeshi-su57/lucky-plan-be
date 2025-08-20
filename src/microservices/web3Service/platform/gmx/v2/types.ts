export enum DepositType {
  Normal,
  Shift,
  Glv,
}

export type DepositCreatedEventType = {
  account: `0x${string}`;
  receiver: `0x${string}`;
  callbackContract: `0x${string}`;
  market: `0x${string}`;
  initialLongToken: `0x${string}`;
  initialShortToken: `0x${string}`;
  longTokenSwapPath: `0x${string}`[];
  shortTokenSwapPath: `0x${string}`[];
  initialLongTokenAmount: bigint;
  initialShortTokenAmount: bigint;
  minMarketTokens: bigint;
  updatedAtTime: bigint;
  executionFee: bigint;
  callbackGasLimit: bigint;
  depositType: bigint;
  shouldUnwrapNativeToken: boolean;
  key: `0x${string}`;
};

// {
//   account: '0x528A5bac7E746C9A509A1f4F6dF58A03d44279F9',
//   receiver: '0x528A5bac7E746C9A509A1f4F6dF58A03d44279F9',
//   callbackContract: '0x0000000000000000000000000000000000000000',
//   market: '0x6Ecf2133E2C9751cAAdCb6958b9654baE198a797',
//   initialLongToken: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
//   initialShortToken: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
//   longTokenSwapPath: [],
//   shortTokenSwapPath: [],
//   initialLongTokenAmount: 3682219553400536319n,
//   initialShortTokenAmount: 7862220493n,
//   minMarketTokens: 0n,
//   updatedAtTime: 1743345087n,
//   executionFee: 0n,
//   callbackGasLimit: 0n,
//   depositType: 1n,
//   shouldUnwrapNativeToken: false,
//   key: '0x65b875d86ef0e6e23b9126727e911ad8990a9b3a54c9b1700a41b3ae69d9f933'
// }

export type DepositExecutedEventType = {
  account: `0x${string}`;
  longTokenAmount: bigint;
  shortTokenAmount: bigint;
  receivedMarketTokens: bigint;
  swapPricingType: bigint;
  key: `0x${string}`;
};

// {
//   account: '0xb4bBCCb27cD9b6eA71105cf20b3D755fa527a6f0',
//   longTokenAmount: 0n,
//   shortTokenAmount: 136000000n,
//   receivedMarketTokens: 65428437344067603767n,
//   swapPricingType: 3n,
//   key: '0xcc52afd1d97aa9213f2066d6f1a93b4673285b91038c226e045be3587e6f882f'
// }

export type DepositCancelledEventType = {
  account: `0x${string}`;
  key: `0x${string}`;
  reason: string;
  reasonBytes: `0x${string}`;
};

export enum OrderType {
  // @dev MarketSwap: swap token A to token B at the current market price
  // the order will be cancelled if the minOutputAmount cannot be fulfilled
  MarketSwap,
  // @dev LimitSwap: swap token A to token B if the minOutputAmount can be fulfilled
  LimitSwap,
  // @dev MarketIncrease: increase position at the current market price
  // the order will be cancelled if the position cannot be increased at the acceptablePrice
  MarketIncrease,
  // @dev LimitIncrease: increase position if the triggerPrice is reached and the acceptablePrice can be fulfilled
  LimitIncrease,
  // @dev MarketDecrease: decrease position at the current market price
  // the order will be cancelled if the position cannot be decreased at the acceptablePrice
  MarketDecrease,
  // @dev LimitDecrease: decrease position if the triggerPrice is reached and the acceptablePrice can be fulfilled
  LimitDecrease,
  // @dev StopLossDecrease: decrease position if the triggerPrice is reached and the acceptablePrice can be fulfilled
  StopLossDecrease,
  // @dev Liquidation: allows liquidation of positions if the criteria for liquidation are met
  Liquidation,
  // @dev StopIncrease: increase position if the triggerPrice is reached and the acceptablePrice can be fulfilled
  StopIncrease,
}

export type OrderCreatedEventType = {
  account: `0x${string}`;
  receiver: `0x${string}`;
  callbackContract: `0x${string}`;
  uiFeeReceiver: `0x${string}`;
  market: `0x${string}`;
  initialCollateralToken: `0x${string}`;
  swapPath: `0x${string}`[];
  orderType: bigint;
  decreasePositionSwapType: bigint;
  sizeDeltaUsd: bigint;
  initialCollateralDeltaAmount: bigint;
  triggerPrice: bigint;
  acceptablePrice: bigint;
  executionFee: bigint;
  callbackGasLimit: bigint;
  minOutputAmount: bigint;
  updatedAtTime: bigint;
  validFromTime: bigint;
  isLong: boolean;
  shouldUnwrapNativeToken: boolean;
  autoCancel: boolean;
  key: `0x${string}`;
};

// {
//   account: '0xae63120cA7f6aFBF13412B8b7a44E0C4ba07e32e',
//   receiver: '0xae63120cA7f6aFBF13412B8b7a44E0C4ba07e32e',
//   callbackContract: '0x0000000000000000000000000000000000000000',
//   uiFeeReceiver: '0xff00000000000000000000000000000000000001',
//   market: '0x70d95587d40A2caf56bd97485aB3Eec10Bee6336',
//   initialCollateralToken: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
//   swapPath: [],
//   orderType: 6n,
//   decreasePositionSwapType: 0n,
//   sizeDeltaUsd: 2682538578974844174657600000000000n,
//   initialCollateralDeltaAmount: 149034299n,
//   triggerPrice: 1824000000000000n,
//   acceptablePrice: 115792089237316195423570985008687907853269984665640564039457n,
//   executionFee: 55204422000000n,
//   callbackGasLimit: 0n,
//   minOutputAmount: 0n,
//   updatedAtTime: 1743345581n,
//   validFromTime: 0n,
//   isLong: false,
//   shouldUnwrapNativeToken: false,
//   autoCancel: true,
//   key: '0xb8f17edfae355d19706a327dfcea727474de4cd845331d1c6a87df8bdee4a9bd'
// }

export enum SecondaryOrderType {
  None,
  Adl,
}

export type OrderExecutedEventType = {
  account: `0x${string}`;
  key: `0x${string}`;
  secondaryOrderType: bigint;
};

// {
//   account: '0xD37f3DC3123F25f6f0e893933904F96777eC63E9',
//   secondaryOrderType: 0n,
//   key: '0xff3730ca689eb6f4c34da5293ef1d91e732d2396944ae2c6bdfee3c831285b44'
// }

export type OrderUpdatedEventType = {
  account: `0x${string}`;
  sizeDeltaUsd: bigint;
  acceptablePrice: bigint;
  triggerPrice: bigint;
  minOutputAmount: bigint;
  updatedAtTime: bigint;
  validFromTime: bigint;
  autoCancel: boolean;
  key: `0x${string}`;
};

// {
//   account: '0x26CEa4b82199804fB0921CEC8cCc375A9aA01DE0',
//   sizeDeltaUsd: 1925696852420115621819174552000000n,
//   acceptablePrice: 1765280000000000n,
//   triggerPrice: 1760000000000000n,
//   minOutputAmount: 0n,
//   updatedAtTime: 1743345442n,
//   validFromTime: 0n,
//   autoCancel: true,
//   key: '0xb6190a4c50805a114307ca80d86532e71a9615ec588aae100d795d15ce2cc1ff'
// }

export type OrderSizeDeltaAutoUpdatedEventType = {
  key: `0x${string}`;
  sizeDeltaUsd: bigint;
  nextSizeDeltaUsd: bigint;
};

export type OrderCollateralDeltaAmountAutoUpdatedEventType = {
  key: `0x${string}`;
  collateralDeltaAmount: bigint;
  nextCollateralDeltaAmount: bigint;
};

export type OrderCancelledEventType = {
  account: `0x${string}`;
  key: `0x${string}`;
  reasonBytes: `0x${string}`;
  reason: string;
};

export type OrderFrozenEventType = {
  account: `0x${string}`;
  key: `0x${string}`;
  reasonBytes: `0x${string}`;
  reason: string;
};

export type PositionIncreaseEventType = {
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
  priceImpactUsd: bigint;
  priceImpactAmount: bigint;
  isLong: boolean;
  orderKey: `0x${string}`;
  positionKey: `0x${string}`;
};

// {
//   account: '0xD37f3DC3123F25f6f0e893933904F96777eC63E9',
//   market: '0x6Ecf2133E2C9751cAAdCb6958b9654baE198a797',
//   collateralToken: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
//   sizeInUsd: 218543935592291394883600000000000n,
//   sizeInTokens: 92970565374n,
//   collateralAmount: 19868872n,
//   borrowingFactor: 130442283467114406616019695161n,
//   fundingFeeAmountPerSize: 219933641568219260829n,
//   longTokenClaimableFundingAmountPerSize: 1078253340290567906370990n,
//   shortTokenClaimableFundingAmountPerSize: 16266491606794770727n,
//   executionPrice: 2350678784334993871902n,
//   'indexTokenPrice.max': 2350090938238862250000n,
//   'indexTokenPrice.min': 2349976433081397750000n,
//   'collateralTokenPrice.max': 999984620136370050000000n,
//   'collateralTokenPrice.min': 999984620136370050000000n,
//   sizeDeltaUsd: 218543935592291394883600000000000n,
//   sizeDeltaInTokens: 92970565374n,
//   orderType: 2n,
//   increasedAtTime: 1743346573n,
//   collateralDeltaAmount: 19868872n,
//   priceImpactUsd: -54649717237365068548211762083n,
//   priceImpactAmount: -23255433n,
//   isLong: true,
//   orderKey: '0xd7e80e929474d76245fd6e28b1ac1752f47238e32f9625b4e50b9b4baae207fe',
//   positionKey: '0x2394113eefde29017fba160a170acb2df2232002f91e88918e42c62278c541ce'
// }

export type PositionDecreaseEventType = {
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
  basePnlUsd: bigint;
  uncappedBasePnlUsd: bigint;
  isLong: boolean;
  orderKey: `0x${string}`;
  positionKey: `0x${string}`;
};

// {
//   account: '0xf59C594043734250c13eF060b01aEdEDdd347290',
//   market: '0x09400D9DB990D5ed3f35D7be61DfAEB900Af03C9',
//   collateralToken: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
//   sizeInUsd: 0n,
//   sizeInTokens: 0n,
//   collateralAmount: 0n,
//   borrowingFactor: 119949294957030950728878389819n,
//   fundingFeeAmountPerSize: 69506393190960682967n,
//   longTokenClaimableFundingAmountPerSize: 87281829483704192842n,
//   shortTokenClaimableFundingAmountPerSize: 378241141707354577284n,
//   executionPrice: 124891846384165185385897n,
//   'indexTokenPrice.max': 124873576575436632500000n,
//   'indexTokenPrice.min': 124867236343318437500000n,
//   'collateralTokenPrice.max': 999984331234750750000000n,
//   'collateralTokenPrice.min': 999984331234750750000000n,
//   sizeDeltaUsd: 19625290549111734823944793391125000n,
//   sizeDeltaInTokens: 158001364319n,
//   collateralDeltaAmount: 241140840n,
//   'values.priceImpactDiffUsd': 0n,
//   orderType: 4n,
//   decreasedAtTime: 1743346500n,
//   priceImpactUsd: -2886654704958530702324326383916n,
//   basePnlUsd: -104904917200372934186222376375000n,
//   uncappedBasePnlUsd: -104904917200372934186222376375000n,
//   isLong: false,
//   orderKey: '0x33e50ada58f341932bfdf9c3b2cd957e541ffc0e6b72c2772b809d61fed17d12',
//   positionKey: '0xb39ca0584dfe2c483b0f99ddfc0b1d4ee9846b385a11561b10e8944e62f38ebf'
// }

export type InsolventCloseEventType = {
  orderKey: `0x${string}`;
  positionCollateralAmount: bigint;
  remainingCostUsd: bigint;
  basePnlUsd: bigint;
  step: string;
};

// {
//   positionCollateralAmount: 106078569n,
//   remainingCostUsd: 2912005198049998792643064000000n,
//   basePnlUsd: -80098323808281306742209611000000n,
//   orderKey: '0xd0ac701cf24a5d8ecbb10f8ae9a4c69dce2d6f7dd2b1700a26695bd0233831c7',
//   step: 'fees'
// }

export type InsufficientFundingFeePaymentEventType = {
  market: `0x${string}`;
  token: `0x${string}`;
  expectedAmount: bigint;
  amountPaidInCollateralToken: bigint;
  amountPaidInSecondaryOutputToken: bigint;
};

export type PositionFeesCollectedEventType = {
  market: `0x${string}`;
  collateralToken: `0x${string}`;
  affiliate: `0x${string}`;
  trader: `0x${string}`;
  uiFeeReceiver: `0x${string}`;
  'collateralTokenPrice.min': bigint;
  'collateralTokenPrice.max': bigint;
  tradeSizeUsd: bigint;
  fundingFeeAmount: bigint;
  claimableLongTokenAmount: bigint;
  claimableShortTokenAmount: bigint;
  latestFundingFeeAmountPerSize: bigint;
  latestLongTokenClaimableFundingAmountPerSize: bigint;
  latestShortTokenClaimableFundingAmountPerSize: bigint;
  borrowingFeeUsd: bigint;
  borrowingFeeAmount: bigint;
  borrowingFeeReceiverFactor: bigint;
  borrowingFeeAmountForFeeReceiver: bigint;
  positionFeeFactor: bigint;
  protocolFeeAmount: bigint;
  positionFeeReceiverFactor: bigint;
  feeReceiverAmount: bigint;
  feeAmountForPool: bigint;
  positionFeeAmountForPool: bigint;
  positionFeeAmount: bigint;
  totalCostAmount: bigint;
  uiFeeReceiverFactor: bigint;
  uiFeeAmount: bigint;
  'referral.totalRebateFactor': bigint;
  'referral.adjustedAffiliateRewardFactor': bigint;
  'referral.traderDiscountFactor': bigint;
  'referral.totalRebateAmount': bigint;
  'referral.traderDiscountAmount': bigint;
  'referral.affiliateRewardAmount': bigint;
  isIncrease: boolean;
  orderKey: `0x${string}`;
  positionKey: `0x${string}`;
  referralCode: `0x${string}`;
};

// {
//   market: '0x55391D178Ce46e7AC8eaAEa50A72D1A5a8A622Da',
//   collateralToken: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
//   affiliate: '0xB001378EeeC830D4b0FC4809Ad2AE2843355D68B',
//   trader: '0xD5789CB742645947fF3E8e1cC78a256acA512861',
//   uiFeeReceiver: '0xff00000000000000000000000000000000000001',
//   'collateralTokenPrice.min': 999961142758151700000000n,
//   'collateralTokenPrice.max': 999961142758151700000000n,
//   tradeSizeUsd: 9729470005361548834000000000000000n,
//   fundingFeeAmount: 0n,
//   claimableLongTokenAmount: 0n,
//   claimableShortTokenAmount: 0n,
//   latestFundingFeeAmountPerSize: 332677795592958861761n,
//   latestLongTokenClaimableFundingAmountPerSize: 71766775274890235293899523301n,
//   latestShortTokenClaimableFundingAmountPerSize: 4656774143280333173n,
//   borrowingFeeUsd: 0n,
//   borrowingFeeAmount: 0n,
//   borrowingFeeReceiverFactor: 370000000000000000000000000000n,
//   borrowingFeeAmountForFeeReceiver: 0n,
//   positionFeeFactor: 600000000000000000000000000n,
//   protocolFeeAmount: 4378432n,
//   positionFeeReceiverFactor: 370000000000000000000000000000n,
//   feeReceiverAmount: 1620019n,
//   feeAmountForPool: 2758413n,
//   positionFeeAmountForPool: 2758413n,
//   positionFeeAmount: 5837908n,
//   totalCostAmount: 5254118n,
//   uiFeeReceiverFactor: 0n,
//   uiFeeAmount: 0n,
//   'referral.totalRebateFactor': 250000000000000000000000000000n,
//   'referral.adjustedAffiliateRewardFactor': 150000000000000000000000000000n,
//   'referral.traderDiscountFactor': 100000000000000000000000000000n,
//   'referral.totalRebateAmount': 1459476n,
//   'referral.traderDiscountAmount': 583790n,
//   'referral.affiliateRewardAmount': 875686n,
//   isIncrease: true,
//   orderKey: '0x4f36f03889557390c201e42338f2b80bd8dc62ab177174558134d08ccb6457ba',
//   positionKey: '0xe654e1448fe1b3362c2626e34f66e4b0893edb95c97d6666580a7323bf362850',
//   referralCode: '0x676d787765620000000000000000000000000000000000000000000000000000'
// }

export type PositionFeesInfoEventType = PositionFeesCollectedEventType;

export type ShiftCreatedEventType = {
  account: `0x${string}`;
  receiver: `0x${string}`;
  callbackContract: `0x${string}`;
  fromMarket: `0x${string}`;
  toMarket: `0x${string}`;
  marketTokenAmount: bigint;
  minMarketTokens: bigint;
  updatedAtTime: bigint;
  executionFee: bigint;
  callbackGasLimit: bigint;
  key: `0x${string}`;
};

export type ShiftExecutedEventType = {
  account: `0x${string}`;
  receivedMarketTokens: bigint;
  key: `0x${string}`;
};

export type ShiftCancelledEventType = {
  account: `0x${string}`;
  key: `0x${string}`;
  reasonBytes: `0x${string}`;
  reason: string;
};

export enum WithdrawalType {
  Normal,
  Shift,
  Glv,
}

export type WithdrawalCreatedEventType = {
  account: `0x${string}`;
  receiver: `0x${string}`;
  callbackContract: `0x${string}`;
  market: `0x${string}`;
  longTokenSwapPath: `0x${string}`[];
  shortTokenSwapPath: `0x${string}`[];
  marketTokenAmount: bigint;
  minLongTokenAmount: bigint;
  minShortTokenAmount: bigint;
  updatedAtTime: bigint;
  executionFee: bigint;
  callbackGasLimit: bigint;
  withdrawalType: bigint;
  shouldUnwrapNativeToken: boolean;
  key: `0x${string}`;
};

export enum SwapPricingType {
  Swap,
  Shift,
  Atomic,
  Deposit,
  Withdrawal,
}

export type WithdrawalExecutedEventType = {
  account: `0x${string}`;
  swapPricingType: bigint;
  key: `0x${string}`;
};

export type WithdrawalCancelledEventType = {
  account: `0x${string}`;
  key: `0x${string}`;
  reasonBytes: `0x${string}`;
  reason: string;
};
