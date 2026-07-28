import { parseAbi, toEventSelector } from 'viem';

/**
 * Event-only ABI for the legacy GMX V1 Vault.
 *
 * The Vault emits a primary position event plus one or more companion events.
 * The companion events are included because historical indexing needs them to
 * reconstruct post-trade position state, realised PnL, and the full margin fee.
 */
export const gmxV1VaultAbi = parseAbi([
  'event IncreasePosition(bytes32 key, address account, address collateralToken, address indexToken, uint256 collateralDelta, uint256 sizeDelta, bool isLong, uint256 price, uint256 fee)',
  'event DecreasePosition(bytes32 key, address account, address collateralToken, address indexToken, uint256 collateralDelta, uint256 sizeDelta, bool isLong, uint256 price, uint256 fee)',
  'event LiquidatePosition(bytes32 key, address account, address collateralToken, address indexToken, bool isLong, uint256 size, uint256 collateral, uint256 reserveAmount, int256 realisedPnl, uint256 markPrice)',
  'event UpdatePosition(bytes32 key, uint256 size, uint256 collateral, uint256 averagePrice, uint256 entryFundingRate, uint256 reserveAmount, int256 realisedPnl, uint256 markPrice)',
  'event ClosePosition(bytes32 key, uint256 size, uint256 collateral, uint256 averagePrice, uint256 entryFundingRate, uint256 reserveAmount, int256 realisedPnl)',
  'event UpdatePnl(bytes32 key, bool hasProfit, uint256 delta)',
  'event CollectMarginFees(address token, uint256 feeUsd, uint256 feeTokens)',
]);

export const gmxV1VaultReadAbi = parseAbi([
  'function allWhitelistedTokensLength() view returns (uint256)',
  'function allWhitelistedTokens(uint256) view returns (address)',
  'function whitelistedTokens(address) view returns (bool)',
  'function stableTokens(address) view returns (bool)',
  'function shortableTokens(address) view returns (bool)',
  'function tokenDecimals(address) view returns (uint256)',
]);

export const gmxV1EventSignatures: Record<string, string> = Object.fromEntries(
  gmxV1VaultAbi.map((event) => [toEventSelector(event), event.name]),
);
