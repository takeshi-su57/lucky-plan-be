export const SIMULATION_EVALUATOR = {
  queueName: 'simulation-evaluator-dispatch',
  workerCacheDirectory: ['.cache', 'simulation-evaluator-worker'],
  pollDelayMs: 2_000,
  heartbeatIntervalMs: 25_000,
  workerHeartbeatTimeoutMs: 90_000,
  leaseDurationMs: 90_000,
  prebuildChunkTargetBytes: 10 * 1024 * 1024,
  prebuildChunkSourceRecordLimit: 8_000,
  eventLogAddressBatchSize: 100,
  eventLogRecordBatchSize: 2_000,
  gateway: {
    basePath: '/internal/simulation-evaluator',
    enrollment: '/enroll',
    presence: '/presence',
    poll: '/poll',
    task: (taskId: string) =>
      `/internal/simulation-evaluator/${encodeURIComponent(taskId)}`,
  },
} as const;
