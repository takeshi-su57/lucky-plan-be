import {
  SignalGenerator,
  Filter,
  PositionSizer,
  ExitCondition,
  Platform,
} from './interfaces';

/**
 * Factory function type for creating components
 */
export type ComponentFactory<T> = (params: Record<string, any>) => T;

/**
 * Option for select type parameters
 */
export interface SelectOption {
  value: string;
  label: string;
}

/**
 * Parameter metadata for component documentation
 */
export interface ParamMeta {
  name: string;
  type: 'number' | 'boolean' | 'string' | 'select';
  required: boolean;
  default?: number | boolean | string;
  description?: string;
  min?: number;
  max?: number;
  options?: SelectOption[]; // For 'select' type
}

/**
 * Component metadata for API exposure
 */
export interface ComponentMeta {
  name: string;
  description?: string;
  params: ParamMeta[];
}

/**
 * Registry entry containing both factory and metadata
 */
interface RegistryEntry<T> {
  factory: ComponentFactory<T>;
  meta: ComponentMeta;
}

/**
 * Registry structure for all component types
 */
export interface ComponentRegistry {
  signals: Record<string, RegistryEntry<SignalGenerator>>;
  filters: Record<string, RegistryEntry<Filter>>;
  risk: Record<string, RegistryEntry<PositionSizer>>;
  exits: Record<string, RegistryEntry<ExitCondition>>;
  platforms: Record<string, RegistryEntry<Platform>>;
}

/**
 * Global component registry
 * Components register themselves here to be available for strategy composition
 */
export const registry: ComponentRegistry = {
  signals: {},
  filters: {},
  risk: {},
  exits: {},
  platforms: {},
};

/**
 * Register a signal generator component with metadata
 */
export function registerSignal(
  name: string,
  factory: ComponentFactory<SignalGenerator>,
  meta: ComponentMeta,
): void {
  registry.signals[name] = { factory, meta };
}

/**
 * Register a filter component with metadata
 */
export function registerFilter(
  name: string,
  factory: ComponentFactory<Filter>,
  meta: ComponentMeta,
): void {
  registry.filters[name] = { factory, meta };
}

/**
 * Register a position sizer component with metadata
 */
export function registerRisk(
  name: string,
  factory: ComponentFactory<PositionSizer>,
  meta: ComponentMeta,
): void {
  registry.risk[name] = { factory, meta };
}

/**
 * Register an exit condition component with metadata
 */
export function registerExit(
  name: string,
  factory: ComponentFactory<ExitCondition>,
  meta: ComponentMeta,
): void {
  registry.exits[name] = { factory, meta };
}

/**
 * Get a signal generator factory by name
 */
export function getSignalFactory(
  name: string,
): ComponentFactory<SignalGenerator> | undefined {
  return registry.signals[name]?.factory;
}

/**
 * Get a filter factory by name
 */
export function getFilterFactory(
  name: string,
): ComponentFactory<Filter> | undefined {
  return registry.filters[name]?.factory;
}

/**
 * Get a position sizer factory by name
 */
export function getRiskFactory(
  name: string,
): ComponentFactory<PositionSizer> | undefined {
  return registry.risk[name]?.factory;
}

/**
 * Get an exit condition factory by name
 */
export function getExitFactory(
  name: string,
): ComponentFactory<ExitCondition> | undefined {
  return registry.exits[name]?.factory;
}

/**
 * Register a platform component with metadata
 */
export function registerPlatform(
  name: string,
  factory: ComponentFactory<Platform>,
  meta: ComponentMeta,
): void {
  registry.platforms[name] = { factory, meta };
}

/**
 * Get a platform factory by name
 */
export function getPlatformFactory(
  name: string,
): ComponentFactory<Platform> | undefined {
  return registry.platforms[name]?.factory;
}

/**
 * List all registered component names by type
 */
export function listComponents(): {
  signals: string[];
  filters: string[];
  risk: string[];
  exits: string[];
  platforms: string[];
} {
  return {
    signals: Object.keys(registry.signals),
    filters: Object.keys(registry.filters),
    risk: Object.keys(registry.risk),
    exits: Object.keys(registry.exits),
    platforms: Object.keys(registry.platforms),
  };
}

/**
 * Get component metadata for a specific type and name
 */
export function getComponentMeta(
  type: 'signals' | 'filters' | 'risk' | 'exits' | 'platforms',
  name: string,
): ComponentMeta | undefined {
  return registry[type][name]?.meta;
}

/**
 * Get all component metadata (aggregated from registered components)
 */
export function getAllComponentMeta(): {
  signals: Record<string, ComponentMeta>;
  filters: Record<string, ComponentMeta>;
  risk: Record<string, ComponentMeta>;
  exits: Record<string, ComponentMeta>;
  platforms: Record<string, ComponentMeta>;
} {
  const extractMeta = <T>(entries: Record<string, RegistryEntry<T>>) =>
    Object.fromEntries(
      Object.entries(entries).map(([key, entry]) => [key, entry.meta]),
    );

  return {
    signals: extractMeta(registry.signals),
    filters: extractMeta(registry.filters),
    risk: extractMeta(registry.risk),
    exits: extractMeta(registry.exits),
    platforms: extractMeta(registry.platforms),
  };
}
