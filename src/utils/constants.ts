import { etherUnits } from 'viem';

export const MainCollateralIndex = {
  137: 3,
  8453: 1,
  42161: 3,
  421614: 3,
  4326: 1,
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
  simulationProgressUpdated: 'simulationProgressUpdated',
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
    SimulationProgressUpdated: 'SIMULATION_PROGRESS_UPDATED',
  },
  Simulations: {
    SimulationPlanCreated: 'SIMULATION_PLAN_CREATED',
    SimulationBotCreated: 'SIMULATION_BOT_CREATED',
  },
  Tasks: {
    TaskCreated: 'TASK_CREATED',
    TaskUpdated: 'TASK_UPDATED',
  },
  Leaderboard: {
    GetAdaptionStatus: 'GET_ADAPTION_STATUS',
    StartAdaption: 'START_ADAPTION',
  },
};

export const SERVICE_NAMES = {
  REDIS_SERVICE: 'REDIS_SERVICE',
  API_SERVICE: 'API_SERVICE',
  LEADERBOARD_SERVICE: 'LEADERBOARD_SERVICE',
  COPY_TRADING_SERVICE: 'COPY_TRADING_SERVICE',
};
