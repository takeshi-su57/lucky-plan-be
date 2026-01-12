import * as path from 'path';
import { StrategyLoader } from '../../core/strategy-loader';
import { StrategyConfig } from '../../core/interfaces';

/**
 * Default strategies directory
 */
export const STRATEGIES_DIR = __dirname;

/**
 * Get path to a strategy config file
 */
export function getStrategyPath(symbol: string): string {
  return path.join(STRATEGIES_DIR, `${symbol}.json`);
}

/**
 * Load a strategy config by symbol
 */
export function loadStrategyConfig(symbol: string): StrategyConfig {
  return StrategyLoader.loadConfig(getStrategyPath(symbol));
}

/**
 * Load all available strategy configs
 */
export function loadAllStrategyConfigs(): StrategyConfig[] {
  return StrategyLoader.loadAllConfigs(STRATEGIES_DIR);
}

/**
 * List available strategy symbols
 */
export function listAvailableStrategies(): string[] {
  const configs = loadAllStrategyConfigs();
  return configs.map((c) => c.symbol);
}
