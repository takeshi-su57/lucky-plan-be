import { etherUnits } from 'viem';

export const USDCCollateralIndex = {
  137: 3,
  8453: 1,
  42161: 3,
  421614: 3,
};
export const CloseMissionAction = 'CloseMissionAction';

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
};

export const MIN_GAS = BigInt(0.0005 * Math.pow(10, etherUnits.wei));
export const MAX_GAS = BigInt(0.001 * Math.pow(10, etherUnits.wei));

export const MIN_POSITION_SIZE = 5_000_000n; // 10 USDC
export const MIN_FEE = 1000_000n; // 1 USDC

export const PATTERNS = {
  killProcessEvent: 'KILL_PROCESS_EVENT',
  ProcessStatus: 'PROCESS_STATUS',
  AskProcessStatus: 'ASK_PROCESS_STATUS',
  BotHook: {
    IsRunning: 'IS_BOT_HOOK_RUNNING',
  },
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
  Leaderboard: {
    GetAdaptionStatus: 'GET_ADAPTION_STATUS',
    StartAdaption: 'START_ADAPTION',
    BuildPnlSnapshotV2: 'BUILD_PNL_SNAPSHOT_V2',
    DynamicSnapshotV2Build: 'DYNAMIC_SNAPSHOT_V2_BUILD',
    InitializePnlSnapshotV2: 'INITIALIZE_PNL_SNAPSHOT_V2',
    BuildPnlSnapshot: 'BUILD_PNL_SNAPSHOT',
    DynamicSnapshotBuild: 'DYNAMIC_SNAPSHOT_BUILD',
    InitializePnlSnapshot: 'INITIALIZE_PNL_SNAPSHOT',
  },
};

export const SERVICE_NAMES = {
  REDIS_SERVICE: 'REDIS_SERVICE',
  API_SERVICE: 'API_SERVICE',
  LEADERBOARD_SERVICE: 'LEADERBOARD_SERVICE',
  TRADING_SERVICE: 'TRADING_SERVICE',
  BOT_HOOKS_SERVICE: 'BOT_HOOKS_SERVICE',
};
