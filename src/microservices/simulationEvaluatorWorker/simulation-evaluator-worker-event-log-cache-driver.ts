export type SimulationEvaluatorEventLogCacheDriver = 'file' | 'sqlite';

export function getSimulationEvaluatorEventLogCacheDriver(): SimulationEvaluatorEventLogCacheDriver {
  const value = process.env.SIMULATION_EVALUATOR_EVENT_LOG_CACHE_DRIVER;

  if (!value || !value.trim()) return 'file';

  switch (value.trim().toLowerCase()) {
    case 'file':
      return 'file';
    case 'sqlite':
      return 'sqlite';
    default:
      throw new Error(
        'SIMULATION_EVALUATOR_EVENT_LOG_CACHE_DRIVER must be "file" or "sqlite"',
      );
  }
}
