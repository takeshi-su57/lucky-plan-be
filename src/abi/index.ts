import { getAbiItem } from 'viem';

import { gnsMultiCollatDiamondAbi } from './GNSMultiCollatDiamond';

export const openTradeAbi = getAbiItem({
  abi: gnsMultiCollatDiamondAbi,
  name: 'openTrade',
});

export type OpenTradeArgs = typeof openTradeAbi.inputs;

export const openTradeNativeAbi = getAbiItem({
  abi: gnsMultiCollatDiamondAbi,
  name: 'openTradeNative',
});

export type OpenTradeNativeArgs = typeof openTradeNativeAbi.inputs;

export const updateMaxClosingSlippagePAbi = getAbiItem({
  abi: gnsMultiCollatDiamondAbi,
  name: 'updateMaxClosingSlippageP',
});

export type UpdateMaxClosingSlippagePArgs =
  typeof updateMaxClosingSlippagePAbi.inputs;

export const closeTradeMarketAbi = getAbiItem({
  abi: gnsMultiCollatDiamondAbi,
  name: 'closeTradeMarket',
});

export type CloseTradeMarketArgs = typeof closeTradeMarketAbi.inputs;

export const updateOpenOrderAbi = getAbiItem({
  abi: gnsMultiCollatDiamondAbi,
  name: 'updateOpenOrder',
});

export type UpdateOpenOrderArgs = typeof updateOpenOrderAbi.inputs;

export const cancelOpenOrderAbi = getAbiItem({
  abi: gnsMultiCollatDiamondAbi,
  name: 'cancelOpenOrder',
});

export type CancelOpenOrderArgs = typeof cancelOpenOrderAbi.inputs;

export const updateTpAbi = getAbiItem({
  abi: gnsMultiCollatDiamondAbi,
  name: 'updateTp',
});

export type UpdateTpArgs = typeof updateTpAbi.inputs;

export const updateSlAbi = getAbiItem({
  abi: gnsMultiCollatDiamondAbi,
  name: 'updateSl',
});

export type UpdateSlArgs = typeof updateSlAbi.inputs;

export const updateLeverageAbi = getAbiItem({
  abi: gnsMultiCollatDiamondAbi,
  name: 'updateLeverage',
});

export type UpdateLeverageArgs = typeof updateLeverageAbi.inputs;

export const increasePositionSizeAbi = getAbiItem({
  abi: gnsMultiCollatDiamondAbi,
  name: 'increasePositionSize',
});

export type IncreasePositionSizeArgs = typeof increasePositionSizeAbi.inputs;

export const decreasePositionSizeAbi = getAbiItem({
  abi: gnsMultiCollatDiamondAbi,
  name: 'decreasePositionSize',
});

export type DecreasePositionSizeArgs = typeof decreasePositionSizeAbi.inputs;
