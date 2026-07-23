// The portable release launcher replaces this with version.json at runtime.
// Keep a valid source-tree value so development workers are still identifiable.
export const simulationEvaluatorWorkerVersion = () =>
  process.env.SIMULATION_EVALUATOR_WORKER_VERSION || '0.0.1';
