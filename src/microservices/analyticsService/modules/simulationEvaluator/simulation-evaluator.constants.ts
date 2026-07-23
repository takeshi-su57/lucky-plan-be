export const SIMULATION_EVALUATOR = {
  queueName: 'simulation-evaluator-dispatch',
  workerCacheDirectory: ['.cache', 'simulation-evaluator-worker'],
  pollDelayMs: 2_000,
  enrollmentRetryDelayMs: 30_000,
  heartbeatIntervalMs: 5_000,
  parentSessionTimeoutMs: 30_000,
  workerHeartbeatTimeoutMs: 60_000,
  leaseDurationMs: 90_000,
  gatewayRequestTimeoutMs: 20_000,
  prebuildChunkRequestTimeoutMs: 60_000,
  // A fixed record count avoids repeatedly serializing and gzip-compressing a
  // whole result set just to discover its byte size. The supplied GNS sample
  // estimates this at roughly a 5 MiB gzip payload.
  prebuildChunkSourceRecordLimit: 20_000,
  // Workers lease one additional capacity window locally so a completed child
  // can start its next evaluation without waiting for another poll round-trip.
  // A received targeted admin command pauses this buffer in the worker itself.
  queueLowWatermarkCapacityMultiplier: 2,
  queueHighWatermarkCapacityMultiplier: 3,
  workerClaimCapacityMultiplier: 2,
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
