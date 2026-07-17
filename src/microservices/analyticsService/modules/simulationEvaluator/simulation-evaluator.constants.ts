export const SIMULATION_EVALUATOR = {
  queueName: 'simulation-evaluator-dispatch',
  workerCacheDirectory: ['.cache', 'simulation-evaluator-worker'],
  pollDelayMs: 2_000,
  enrollmentRetryDelayMs: 30_000,
  heartbeatIntervalMs: 5_000,
  parentSessionTimeoutMs: 30_000,
  workerHeartbeatTimeoutMs: 60_000,
  leaseDurationMs: 90_000,
  prebuildChunkTargetBytes: 10 * 1024 * 1024,
  prebuildChunkSourceRecordLimit: 8_000,
  eventLogAddressBatchSize: 100,
  eventLogRecordBatchSize: 2_000,
  gateway: {
    basePath: '/internal/simulation-evaluator',
    heartbeat: '/heartbeat',
    poll: '/poll',
    task: (taskId: string) =>
      `/internal/simulation-evaluator/${encodeURIComponent(taskId)}`,
  },
} as const;
