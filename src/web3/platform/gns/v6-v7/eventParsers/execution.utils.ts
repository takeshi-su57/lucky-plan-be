import {
  PurePerpTradeHistory,
  PerpTradeHistoryOperation,
} from 'src/microservices/apiService/modules/trade-histories/entities/event-logs.entity';
import { getLegacyGnsPositionKey } from '../../utils';
import { getCollateral, getPairName } from '../../v9/configs';
import { LegacyExecutionArgs } from './types';

const LEGACY_CALLBACK_COLLATERAL_INDEX: Record<string, number> = {
  // Polygon DAI callback generations.
  '0xb454d8a8c98035c65bb73fe2a11567b9b044e0fa': 1,
  '0x82e59334da8c667797009bbe82473b55c7a6b311': 1,
  // Polygon WETH / USDC callback stacks.
  '0x0bbed2eac3237ba128643670b7cf3be475933755': 2,
  '0x2ac6749d0affd42c8d61ef25e433f92e375a1aef': 3,
  // Arbitrum DAI callback generations.
  '0x6c612c804c84e3d20e3109c8efd06cd2d8b28f46': 1,
  '0x298a695906e16aea0a184a2815a76ead1a0b7522': 1,
  // Arbitrum WETH / USDC callback stacks.
  '0x62a9f50c92a57c719ff741133caa55c7a81ce019': 2,
  '0x4542256c583bcad66a19a525b57203773a6485bf': 3,
};

export function getLegacyCollateralIndex(
  contractAddress: string,
): number | null {
  return (
    LEGACY_CALLBACK_COLLATERAL_INDEX[contractAddress.toLowerCase()] ?? null
  );
}

export function legacyExecutionToPerpTradeHistory({
  chainId,
  contractAddress,
  args,
  operation,
}: {
  chainId: number;
  contractAddress: string;
  args: LegacyExecutionArgs;
  operation: PerpTradeHistoryOperation;
}): PurePerpTradeHistory | null {
  const collateralIndex = getLegacyCollateralIndex(contractAddress);

  if (!collateralIndex) {
    return null;
  }

  const collateral = getCollateral(chainId, collateralIndex);
  const pairName = getPairName(chainId, Number(args.t.pairIndex));

  if (!collateral || !pairName) {
    return null;
  }

  // The pre-multicollateral event did not include a USD price because DAI was
  // the only collateral. Every later callback collateral requires the emitted
  // price; do not fabricate USD values for WETH or USDC.
  if (collateralIndex !== 1 && args.collateralPriceUsd === undefined) {
    return null;
  }

  const collateralUsdPrice = args.collateralPriceUsd
    ? Number(args.collateralPriceUsd) / 1e8
    : 1;
  const collateralUsd =
    (Number(args.t.positionSizeDai) / Number(collateral.precision)) *
    collateralUsdPrice;

  let usdPnl = 0;
  let usdBasePnl = 0;
  let usdFee = 0;

  if (operation === PerpTradeHistoryOperation.CLOSE) {
    usdPnl =
      ((Number(args.daiSentToTrader) - Number(args.t.positionSizeDai)) /
        Number(collateral.precision)) *
      collateralUsdPrice;
    usdBasePnl = (Number(args.percentProfit) * collateralUsd) / 1e12;
    usdFee = usdPnl - usdBasePnl;
  }

  const collateralInUsd =
    operation === PerpTradeHistoryOperation.OPEN ? collateralUsd : 0;
  const leverage = Number(args.t.leverage);
  const sizeInUsd = collateralInUsd * leverage;
  const collateralDeltaUsd =
    operation === PerpTradeHistoryOperation.CLOSE ? collateralUsd : 0;
  const leverageDelta = leverage;
  const sizeDeltaUsd = collateralDeltaUsd * leverageDelta;

  return {
    positionKey: getLegacyGnsPositionKey(
      args.t.trader,
      Number(args.t.pairIndex),
      Number(args.t.index),
    ),
    address: args.t.trader.toLowerCase() as `0x${string}`,
    pair: pairName,
    operation,
    usdPnl,
    usdBasePnl,
    usdFee,
    sizeInUsd,
    leverage,
    collateralInUsd,
    collateralDeltaUsd,
    sizeDeltaUsd,
    leverageDelta,
    isLong: args.t.buy,
    price: Number(args.price) / 1e10,
    collateralUsdPrice,
  };
}
