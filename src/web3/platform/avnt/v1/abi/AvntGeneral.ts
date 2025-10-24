import { tradingCallbackAbi } from './TradingCallback';
import { tradingAbi } from './Trading';

export const avntGeneralAbi = [...tradingCallbackAbi, ...tradingAbi] as const;
