import {
  Platform,
  OpenPositionResult,
  ClosePositionResult,
  Position,
  TradeDirection,
} from '../../core/interfaces';
import { ComponentMeta } from '../../core/registry';

import { tradingVariables } from './gns-trading-variables';

/**
 * GNS SDK Precision Constants
 * Values from gns-trading-variable.json use these precision scales
 */
const GNS_PRECISION = {
  // Percentage values (fees, thresholds, spreads) use 1e10 precision
  PERCENTAGE: 1e10,

  // Leverage values use 1e3 precision
  LEVERAGE: 1e3,

  // Borrowing rate per second precision (1e10)
  BORROWING_RATE: 1e10,
};

/**
 * Collateral indices
 */
export const GNS_COLLATERAL = {
  DAI: 0,
  WETH: 1,
  USDC: 2,
  GNS: 3,
} as const;

/**
 * Raw pair data from gns-trading-variable.json
 */
export interface GNSPairRaw {
  from: string;
  to: string;
  spreadP: string;
  groupIndex: string;
  feeIndex: string;
}

/**
 * Raw group data from gns-trading-variable.json
 */
export interface GNSGroupRaw {
  name: string;
  minLeverage: string;
  maxLeverage: string;
}

/**
 * Raw fee tier data from gns-trading-variable.json
 */
export interface GNSFeeRaw {
  totalPositionSizeFeeP: string;
  totalLiqCollateralFeeP: string;
  oraclePositionSizeFeeP: string;
  minPositionSizeUsd: string;
}

/**
 * Raw liquidation params from gns-trading-variable.json
 */
export interface GNSLiquidationParamsRaw {
  maxLiqSpreadP: string;
  startLiqThresholdP: string;
  endLiqThresholdP: string;
  startLeverage: string;
  endLeverage: string;
}

/**
 * Raw borrowing params from gns-trading-variable.json
 */
export interface GNSBorrowingParamsRaw {
  borrowingRatePerSecondP: string;
}

/**
 * Raw collateral data from gns-trading-variable.json
 */
export interface GNSCollateralRaw {
  collateralIndex: number;
  symbol: string;
  isActive: boolean;
  borrowingFees: {
    v2: {
      pairParams: GNSBorrowingParamsRaw[];
    };
  };
}

/**
 * Structure of gns-trading-variable.json
 */
export interface GNSTradingVariables {
  lastRefreshed: string;
  maxGainP: number;
  pairs: GNSPairRaw[];
  groups: GNSGroupRaw[];
  fees: GNSFeeRaw[];
  liquidationParams: {
    pairs: GNSLiquidationParamsRaw[];
  };
  collaterals: GNSCollateralRaw[];
}

/**
 * Parsed pair configuration with all values converted to usable numbers
 */
export interface GNSPairConfig {
  pairIndex: number;
  symbol: string; // e.g., "BTC/USD"
  from: string;
  to: string;

  // From pairs[]
  spreadP: number; // Pair spread as percentage
  groupIndex: number;
  feeIndex: number;

  // From groups[groupIndex]
  groupName: string;
  minLeverage: number;
  maxLeverage: number;

  // From fees[feeIndex]
  tradingFeeP: number; // Trading fee as percentage
  liquidationFeeP: number; // Liquidation fee on collateral as percentage
  minPositionSizeUsd: number;

  // From liquidationParams.pairs[pairIndex]
  maxLiqSpreadP: number;
  startLiqThresholdP: number;
  endLiqThresholdP: number;
  startLeverage: number;
  endLeverage: number;

  // From collaterals[].borrowingFees.v2.pairParams[pairIndex]
  borrowingRatePerSecondP: number;
}

/**
 * GNS Constants
 */
const GNS_CONSTANTS = {
  ONE_YEAR_SECONDS: 31536000,
  DEFAULT_MAX_GAIN_P: 900, // 900% = 9x
  DEFAULT_TOTAL_DEPTH_USD: 5000000,
};

/**
 * Parse raw pair config from trading variables JSON
 */
function parsePairConfig(
  pairIndex: number,
  collateralIndex: number = GNS_COLLATERAL.USDC,
): GNSPairConfig {
  const pair = tradingVariables.pairs[pairIndex];
  if (!pair) {
    throw new Error(`Pair index ${pairIndex} not found in trading variables`);
  }

  const groupIndex = parseInt(pair.groupIndex, 10);
  const feeIndex = parseInt(pair.feeIndex, 10);

  const group = tradingVariables.groups[groupIndex];
  if (!group) {
    throw new Error(
      `Group index ${groupIndex} not found for pair ${pairIndex}`,
    );
  }

  const fee = tradingVariables.fees[feeIndex];
  if (!fee) {
    throw new Error(`Fee index ${feeIndex} not found for pair ${pairIndex}`);
  }

  const liqParams = tradingVariables.liquidationParams.pairs[pairIndex];
  if (!liqParams) {
    throw new Error(`Liquidation params not found for pair ${pairIndex}`);
  }

  const collateral = tradingVariables.collaterals[collateralIndex];
  if (!collateral) {
    throw new Error(`Collateral index ${collateralIndex} not found`);
  }

  const borrowingParams = collateral.borrowingFees?.v2?.pairParams?.[pairIndex];

  return {
    pairIndex,
    symbol: `${pair.from}/${pair.to}`,
    from: pair.from,
    to: pair.to,

    // Parse spreadP: "100000000" -> 0.01 (already in percentage)
    spreadP: parseFloat(pair.spreadP) / GNS_PRECISION.PERCENTAGE,
    groupIndex,
    feeIndex,

    // Parse group
    groupName: group.name,
    minLeverage: parseFloat(group.minLeverage) / GNS_PRECISION.LEVERAGE,
    maxLeverage: parseFloat(group.maxLeverage) / GNS_PRECISION.LEVERAGE,

    // Parse fees: "500000000" -> 0.05 (already in percentage)
    tradingFeeP:
      parseFloat(fee.totalPositionSizeFeeP) / GNS_PRECISION.PERCENTAGE,
    liquidationFeeP:
      parseFloat(fee.totalLiqCollateralFeeP) / GNS_PRECISION.PERCENTAGE,
    minPositionSizeUsd: parseFloat(fee.minPositionSizeUsd) / 1e18,

    // Parse liquidation params: "900000000000" -> 90 (already in percentage)
    maxLiqSpreadP:
      parseFloat(liqParams.maxLiqSpreadP) / GNS_PRECISION.PERCENTAGE,
    startLiqThresholdP:
      parseFloat(liqParams.startLiqThresholdP) / GNS_PRECISION.PERCENTAGE,
    endLiqThresholdP:
      parseFloat(liqParams.endLiqThresholdP) / GNS_PRECISION.PERCENTAGE,
    startLeverage: parseFloat(liqParams.startLeverage) / GNS_PRECISION.LEVERAGE,
    endLeverage: parseFloat(liqParams.endLeverage) / GNS_PRECISION.LEVERAGE,

    // Parse borrowing rate: "1268" -> 0.0000001268 (rate per second)
    borrowingRatePerSecondP: borrowingParams
      ? parseFloat(borrowingParams.borrowingRatePerSecondP) /
        GNS_PRECISION.BORROWING_RATE
      : 0,
  };
}

/**
 * Find pair index by symbol (e.g., "BTC/USD" or "BTC")
 */
export function findPairIndex(symbol: string): number {
  const normalizedSymbol = symbol.toUpperCase().replace('-', '/');
  const [from, to] = normalizedSymbol.includes('/')
    ? normalizedSymbol.split('/')
    : [normalizedSymbol, 'USD'];

  const index = tradingVariables.pairs.findIndex(
    (p) => p.from.toUpperCase() === from && p.to.toUpperCase() === to,
  );

  if (index === -1) {
    throw new Error(`Pair ${from}/${to} not found in trading variables`);
  }

  return index;
}

/**
 * Get all available pair symbols
 */
export function getAllPairSymbols(): string[] {
  return tradingVariables.pairs.map((p) => `${p.from}/${p.to}`);
}

/**
 * Get total number of pairs
 */
export function getTotalPairs(): number {
  return tradingVariables.pairs.length;
}

/**
 * Get trading variables metadata
 */
export function getTradingVariablesInfo(): {
  lastRefreshed: string;
  totalPairs: number;
  totalGroups: number;
  totalFees: number;
  collaterals: string[];
} {
  return {
    lastRefreshed: tradingVariables.lastRefreshed,
    totalPairs: tradingVariables.pairs.length,
    totalGroups: tradingVariables.groups.length,
    totalFees: tradingVariables.fees.length,
    collaterals: tradingVariables.collaterals.map((c) => c.symbol),
  };
}

/**
 * GNS Platform Parameters
 */
export interface GNSPlatformParams {
  symbol: string;
}

/**
 * Component metadata for GNS Platform
 */
export const gnsPlatformMeta: ComponentMeta = {
  name: 'Gains Network Platform',
  description:
    'Perpetual futures simulation based on Gains Network (gTrade). Auto-loads pair-specific fees, spreads, leverage limits, liquidation thresholds, and borrowing rates from trading variables.',
  params: [
    {
      name: 'symbol',
      type: 'string',
      required: true,
      default: 'BTC',
      description:
        'Trading pair symbol (e.g., "BTC", "ETH", "BTC/USD", "EUR/USD")',
    },
  ],
};

/**
 * Gains Network (gTrade) Platform
 *
 * Auto-loads pair-specific configuration from gns-trading-variable.json:
 * - spreadP: Fixed spread for the pair
 * - feeIndex → tradingFeeP: Trading fee percentage
 * - groupIndex → leverage limits: Min/max leverage for the pair's group
 * - liquidationParams: Leverage-interpolated liquidation thresholds
 * - borrowingFees: Per-second borrowing rate for the pair (USDC collateral)
 *
 * ## Price Impact Formula (from GNS SDK)
 * totalPriceImpactP = fixedSpreadP + cumulVolPriceImpactP + skewPriceImpactP
 * priceAfterImpact = oraclePrice * (1 + totalPriceImpactP / 100)
 *
 * ## Liquidation Formula
 * Threshold interpolated between startLiqThresholdP and endLiqThresholdP
 * based on leverage within [startLeverage, endLeverage] range.
 *
 * ## Borrowing Fee Formula (V2)
 * fee = positionSizeUsd * borrowingRatePerSecondP * holdingSeconds / 100
 */
export class GNSPlatform implements Platform {
  readonly name = 'gns';

  private pairConfig: GNSPairConfig;

  constructor(params: GNSPlatformParams) {
    const pairIndex = findPairIndex(params.symbol);
    this.pairConfig = parsePairConfig(pairIndex, GNS_COLLATERAL.USDC);
  }

  /**
   * Calculate fixed spread percentage
   * Based on GNS SDK: getFixedSpreadP = pairSpreadP / 2
   */
  private getFixedSpreadP(direction: TradeDirection, isOpen: boolean): number {
    const halfSpread = this.pairConfig.spreadP / 2;

    // LONG open or SHORT close = positive (pay higher price)
    // SHORT open or LONG close = negative (pay lower price)
    if (
      (direction === 'LONG' && isOpen) ||
      (direction === 'SHORT' && !isOpen)
    ) {
      return halfSpread;
    }
    return -halfSpread;
  }

  /**
   * Calculate cumulative volume price impact
   * Simplified: impact = (positionSizeUsd / totalDepthUsd) * 100
   */
  private getCumulVolPriceImpactP(positionSizeUsd: number): number {
    if (positionSizeUsd <= 0) {
      return 0;
    }

    const depthRatio = positionSizeUsd / GNS_CONSTANTS.DEFAULT_TOTAL_DEPTH_USD;
    const impact = depthRatio * 100;

    // Cap at 10%
    return Math.min(impact, 10);
  }

  /**
   * Calculate skew price impact (disabled - V10+ feature)
   */
  private getSkewPriceImpactP(): number {
    return 0;
  }

  /**
   * Calculate total price impact percentage
   */
  private getTotalPriceImpactP(
    positionSizeUsd: number,
    direction: TradeDirection,
    isOpen: boolean,
  ): number {
    const fixedSpreadP = this.getFixedSpreadP(direction, isOpen);
    const cumulVolImpactP = this.getCumulVolPriceImpactP(positionSizeUsd);
    const skewImpactP = this.getSkewPriceImpactP();

    return fixedSpreadP + cumulVolImpactP + skewImpactP;
  }

  /**
   * Apply price impact to oracle price
   */
  private getPriceAfterImpact(
    oraclePrice: number,
    totalPriceImpactP: number,
  ): number {
    const priceAfterImpact = oraclePrice * (1 + totalPriceImpactP / 100);
    if (priceAfterImpact <= 0) {
      throw new Error('Price after impact must be positive');
    }
    return priceAfterImpact;
  }

  /**
   * Get interpolated liquidation threshold based on leverage
   */
  private getLiquidationThreshold(leverage: number): number {
    const config = this.pairConfig;

    if (leverage <= config.startLeverage) {
      return config.startLiqThresholdP;
    }

    if (leverage >= config.endLeverage) {
      return config.endLiqThresholdP;
    }

    // Linear interpolation
    const leverageRange = config.endLeverage - config.startLeverage;
    const leverageProgress = (leverage - config.startLeverage) / leverageRange;
    const thresholdRange = config.startLiqThresholdP - config.endLiqThresholdP;

    return config.startLiqThresholdP - leverageProgress * thresholdRange;
  }

  /**
   * Calculate borrowing fee for holding period
   */
  calculateBorrowingFee(
    positionSizeUsd: number,
    holdingSeconds: number,
  ): number {
    if (holdingSeconds <= 0) {
      return 0;
    }

    const feeDeltaP = this.pairConfig.borrowingRatePerSecondP * holdingSeconds;
    return positionSizeUsd * (feeDeltaP / 100);
  }

  /**
   * Get borrowing fee APR
   */
  getBorrowingFeeAPR(): number {
    return (
      this.pairConfig.borrowingRatePerSecondP *
      GNS_CONSTANTS.ONE_YEAR_SECONDS *
      100
    );
  }

  /**
   * Validate leverage is within pair's group limits
   */
  validateLeverage(leverage: number): {
    valid: boolean;
    adjustedLeverage: number;
  } {
    const { minLeverage, maxLeverage } = this.pairConfig;

    if (leverage < minLeverage) {
      return { valid: false, adjustedLeverage: minLeverage };
    }
    if (leverage > maxLeverage) {
      return { valid: false, adjustedLeverage: maxLeverage };
    }
    return { valid: true, adjustedLeverage: leverage };
  }

  /**
   * Calculate costs and liquidation price for opening a position
   */
  calculateOpenPosition(
    direction: TradeDirection,
    entryPrice: number,
    notionalValue: number,
    leverage: number,
    _margin: number,
  ): OpenPositionResult {
    const positionSizeUsd = notionalValue;

    // Calculate price impact
    const totalPriceImpactP = this.getTotalPriceImpactP(
      positionSizeUsd,
      direction,
      true,
    );

    const adjustedEntryPrice = this.getPriceAfterImpact(
      entryPrice,
      totalPriceImpactP,
    );

    // Calculate opening fee
    const openingFee = notionalValue * (this.pairConfig.tradingFeeP / 100);

    // Calculate liquidation price
    const liquidationThreshold = this.getLiquidationThreshold(leverage);
    const liquidationPercent = liquidationThreshold / 100 / leverage;
    const liquidationPrice =
      direction === 'LONG'
        ? adjustedEntryPrice * (1 - liquidationPercent)
        : adjustedEntryPrice * (1 + liquidationPercent);

    return {
      adjustedEntryPrice,
      openingFee,
      liquidationPrice,
    };
  }

  /**
   * Calculate costs and PnL for closing a position
   */
  calculateClosePosition(
    position: Position,
    exitPrice: number,
  ): ClosePositionResult {
    const exitNotionalValue = position.quantity * exitPrice;

    // Calculate price impact for closing
    const totalPriceImpactP = this.getTotalPriceImpactP(
      exitNotionalValue,
      position.direction,
      false,
    );

    const adjustedExitPrice = this.getPriceAfterImpact(
      exitPrice,
      totalPriceImpactP,
    );

    // Calculate closing fee
    const closingFee = exitNotionalValue * (this.pairConfig.tradingFeeP / 100);

    // Calculate PnL
    const priceDiff =
      position.direction === 'LONG'
        ? adjustedExitPrice - position.entryPrice
        : position.entryPrice - adjustedExitPrice;

    let grossPnl = position.quantity * priceDiff;

    // Apply max gain cap (900% = 9x)
    const maxGain = position.margin * (GNS_CONSTANTS.DEFAULT_MAX_GAIN_P / 100);
    if (grossPnl > maxGain) {
      grossPnl = maxGain;
    }

    const netPnl = grossPnl - closingFee;
    const pnlPercent = (netPnl / position.margin) * 100;

    return {
      adjustedExitPrice,
      closingFee,
      grossPnl,
      netPnl,
      pnlPercent,
    };
  }

  /**
   * Check if a position should be liquidated
   */
  shouldLiquidate(
    position: Position,
    candleLow: number,
    candleHigh: number,
  ): { liquidated: boolean; liquidationPrice?: number } {
    if (position.direction === 'LONG') {
      if (candleLow <= position.liquidationPrice) {
        return {
          liquidated: true,
          liquidationPrice: position.liquidationPrice,
        };
      }
    } else {
      if (candleHigh >= position.liquidationPrice) {
        return {
          liquidated: true,
          liquidationPrice: position.liquidationPrice,
        };
      }
    }

    return { liquidated: false };
  }

  // Getters for pair configuration
  getPairConfig(): GNSPairConfig {
    return { ...this.pairConfig };
  }

  getPairIndex(): number {
    return this.pairConfig.pairIndex;
  }

  getPairSymbol(): string {
    return this.pairConfig.symbol;
  }

  getGroupName(): string {
    return this.pairConfig.groupName;
  }

  getTradingFeeP(): number {
    return this.pairConfig.tradingFeeP;
  }

  getSpreadP(): number {
    return this.pairConfig.spreadP;
  }

  getFixedSpreadPValue(): number {
    return this.pairConfig.spreadP / 2;
  }

  getMinLeverage(): number {
    return this.pairConfig.minLeverage;
  }

  getMaxLeverage(): number {
    return this.pairConfig.maxLeverage;
  }

  getBorrowingRatePerSecondP(): number {
    return this.pairConfig.borrowingRatePerSecondP;
  }

  getMaxGainP(): number {
    return GNS_CONSTANTS.DEFAULT_MAX_GAIN_P;
  }

  getLiquidationConfig(): {
    startLiqThresholdP: number;
    endLiqThresholdP: number;
    startLeverage: number;
    endLeverage: number;
    maxLiqSpreadP: number;
  } {
    return {
      startLiqThresholdP: this.pairConfig.startLiqThresholdP,
      endLiqThresholdP: this.pairConfig.endLiqThresholdP,
      startLeverage: this.pairConfig.startLeverage,
      endLeverage: this.pairConfig.endLeverage,
      maxLiqSpreadP: this.pairConfig.maxLiqSpreadP,
    };
  }

  /**
   * Get summary of pair configuration for logging/debugging
   */
  getSummary(): string {
    const config = this.pairConfig;
    return [
      `Pair: ${config.symbol} (index: ${config.pairIndex})`,
      `Group: ${config.groupName}`,
      `Leverage: ${config.minLeverage}x - ${config.maxLeverage}x`,
      `Trading Fee: ${config.tradingFeeP}%`,
      `Spread: ${config.spreadP}%`,
      `Borrowing APR: ${this.getBorrowingFeeAPR().toFixed(2)}%`,
    ].join('\n');
  }
}
