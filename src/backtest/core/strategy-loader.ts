import * as fs from 'fs';
import * as path from 'path';
import { StrategyConfig } from './interfaces';
import { ComposableStrategy } from './strategy-composer';

/**
 * StrategyLoader
 *
 * Utility class for loading strategy configurations from JSON files
 */
export class StrategyLoader {
  /**
   * Load a single strategy config from a JSON file
   */
  static loadConfig(filePath: string): StrategyConfig {
    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(process.cwd(), filePath);

    if (!fs.existsSync(absolutePath)) {
      throw new Error(`Strategy config file not found: ${absolutePath}`);
    }

    const content = fs.readFileSync(absolutePath, 'utf-8');
    const config: StrategyConfig = JSON.parse(content);

    // Validate required fields
    StrategyLoader.validateConfig(config);

    return config;
  }

  /**
   * Load all strategy configs from a directory
   */
  static loadAllConfigs(dirPath: string): StrategyConfig[] {
    const absolutePath = path.isAbsolute(dirPath)
      ? dirPath
      : path.resolve(process.cwd(), dirPath);

    if (!fs.existsSync(absolutePath)) {
      throw new Error(`Strategy config directory not found: ${absolutePath}`);
    }

    const files = fs
      .readdirSync(absolutePath)
      .filter((f) => f.endsWith('.json'));

    return files.map((file) =>
      StrategyLoader.loadConfig(path.join(absolutePath, file)),
    );
  }

  /**
   * Build a strategy from a config file path
   */
  static loadStrategy(filePath: string): ComposableStrategy {
    const config = StrategyLoader.loadConfig(filePath);
    return ComposableStrategy.fromConfig(config);
  }

  /**
   * Build strategies from all configs in a directory
   */
  static loadAllStrategies(dirPath: string): ComposableStrategy[] {
    const configs = StrategyLoader.loadAllConfigs(dirPath);
    return configs.map((config) => ComposableStrategy.fromConfig(config));
  }

  /**
   * Validate a strategy configuration
   */
  static validateConfig(config: StrategyConfig): void {
    const errors: string[] = [];

    if (!config.symbol) {
      errors.push('symbol is required');
    }

    if (!config.name) {
      errors.push('name is required');
    }

    if (!config.signal) {
      errors.push('signal is required');
    } else if (!config.signal.type) {
      errors.push('signal.type is required');
    }

    if (!config.filters) {
      errors.push('filters array is required (can be empty)');
    }

    if (!config.risk) {
      errors.push('risk configuration is required');
    } else if (!config.risk.type) {
      errors.push('risk.type is required');
    }

    if (!config.exits || !Array.isArray(config.exits)) {
      errors.push('exits array is required');
    } else if (config.exits.length === 0) {
      errors.push('at least one exit is required');
    } else {
      config.exits.forEach((e, i) => {
        if (!e.type) errors.push(`exits[${i}].type is required`);
      });
    }

    if (errors.length > 0) {
      throw new Error(`Invalid strategy config:\n  - ${errors.join('\n  - ')}`);
    }
  }

  /**
   * Create a strategy config programmatically
   * Useful for testing or dynamic strategy creation
   */
  static createConfig(options: {
    symbol: string;
    name: string;
    description?: string;
    signal: { type: string; params: Record<string, any> };
    filters?: Array<{ type: string; params: Record<string, any> }>;
    risk: { type: string; params: Record<string, any> };
    exits: Array<{ type: string; params: Record<string, any> }>;
    settings?: StrategyConfig['settings'];
  }): StrategyConfig {
    return {
      symbol: options.symbol,
      name: options.name,
      description: options.description,
      signal: options.signal,
      filters: options.filters ?? [],
      risk: options.risk,
      exits: options.exits,
      settings: options.settings,
    };
  }
}
