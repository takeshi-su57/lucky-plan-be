import { etherUnits } from 'viem';

export const USDCCollateralIndex = {
  137: 3,
  8453: 1,
  42161: 3,
  421614: 3,
};
export const CloseMissionAction = 'CloseMissionAction';
export const OpenMissionAction = 'OpenMissionAction';

export const SUBSCRIPTION_TOKEN = {
  planCreated: 'planCreated',
  planUpdated: 'planUpdated',
  botCreated: 'botCreated',
  botUpdated: 'botUpdated',
  missionCreated: 'missionCreated',
  missionUpdated: 'missionUpdated',
  taskCreated: 'taskCreated',
  taskUpdated: 'taskUpdated',
  newLog: 'newLog',
  tradingSignalLogUpdated: 'tradingSignalLogUpdated',
  // Backtest subscriptions
  backtestTaskUpdated: 'backtestTaskUpdated',
  backtestResultCreated: 'backtestResultCreated',
  // Template search subscriptions
  templateSearchUpdated: 'templateSearchUpdated',
  // Validation pipeline subscriptions
  validationPipelineUpdated: 'validationPipelineUpdated',
  validationCandidateUpdated: 'validationCandidateUpdated',
};

export const MIN_GAS = BigInt(0.0005 * Math.pow(10, etherUnits.wei));
export const MAX_GAS = BigInt(0.001 * Math.pow(10, etherUnits.wei));

export const MIN_POSITION_SIZE = 5_000_000n; // 10 USDC
export const MIN_FEE = 1000_000n; // 1 USDC

export const PATTERNS = {
  killProcessEvent: 'KILL_PROCESS_EVENT',
  ProcessStatus: 'PROCESS_STATUS',
  AskProcessStatus: 'ASK_PROCESS_STATUS',
  BotHook: {},
  Security: {
    IsValidPassword: 'IS_VALID_PASSWORD',
    IsSafeApp: 'IS_SAFE_APP',
    Encrypt: 'ENCRYPT',
    Decrypt: 'DECRYPT',
  },
  Log: {
    NativeLogEvent: 'NATIVE_LOG_EVENT',
    LogEvent: 'LOG_EVENT',
  },
  Bots: {
    BotCreated: 'BOT_CREATED',
    BotUpdated: 'BOT_UPDATED',
  },
  Missions: {
    MissionCreated: 'MISSION_CREATED',
    MissionUpdated: 'MISSION_UPDATED',
  },
  Plans: {
    PlanCreated: 'PLAN_CREATED',
    PlanUpdated: 'PLAN_UPDATED',
  },
  Tasks: {
    TaskCreated: 'TASK_CREATED',
    TaskUpdated: 'TASK_UPDATED',
  },
  TradingSignalLogs: {
    TradingSignalLogUpdated: 'TRADING_SIGNAL_LOG_UPDATED',
  },
  Leaderboard: {
    GetAdaptionStatus: 'GET_ADAPTION_STATUS',
    StartAdaption: 'START_ADAPTION',
  },
  Snapshot: {
    BuildPnlSnapshotV2: 'BUILD_PNL_SNAPSHOT_V2',
    DynamicSnapshotV2Build: 'DYNAMIC_SNAPSHOT_V2_BUILD',
    InitializePnlSnapshotV2: 'INITIALIZE_PNL_SNAPSHOT_V2',
    BuildPnlSnapshot: 'BUILD_PNL_SNAPSHOT',
    DynamicSnapshotBuild: 'DYNAMIC_SNAPSHOT_BUILD',
    InitializePnlSnapshot: 'INITIALIZE_PNL_SNAPSHOT',
  },
  Backtest: {
    TaskCreated: 'BACKTEST_TASK_CREATED',
    TaskUpdated: 'BACKTEST_TASK_UPDATED',
    TaskCompleted: 'BACKTEST_TASK_COMPLETED',
    TaskFailed: 'BACKTEST_TASK_FAILED',
    ResultCreated: 'BACKTEST_RESULT_CREATED',
    TemplateCreated: 'BACKTEST_TEMPLATE_CREATED',
    TemplateSearchCreated: 'BACKTEST_TEMPLATE_SEARCH_CREATED',
    TemplateSearchUpdated: 'BACKTEST_TEMPLATE_SEARCH_UPDATED',
  },
  Validation: {
    PipelineCreated: 'VALIDATION_PIPELINE_CREATED',
    PipelineUpdated: 'VALIDATION_PIPELINE_UPDATED',
    CandidateUpdated: 'VALIDATION_CANDIDATE_UPDATED',
  },
};

export const SERVICE_NAMES = {
  REDIS_SERVICE: 'REDIS_SERVICE',
  API_SERVICE: 'API_SERVICE',
  LEADERBOARD_SERVICE: 'LEADERBOARD_SERVICE',
  SNAPSHOT_SERVICE: 'SNAPSHOT_SERVICE',
  TRADING_SERVICE: 'TRADING_SERVICE',
  BOT_HOOKS_SERVICE: 'BOT_HOOKS_SERVICE',
  JUP_PERP_EVENT_LOGGER_SERVICE: 'JUP_PERP_EVENT_LOGGER_SERVICE',
};
