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
  Log: 'LOG',
  NativeLog: 'NATIVE_LOG',
  killProcess: 'KILL_PROCESS',
  ProcessStatus: 'PROCESS_STATUS',
};

export const SERVICE_NAMES = {
  REDIS_SERVICE: 'REDIS_SERVICE',
  API_SERVICE: 'API_SERVICE',
  LEADERBOARD_SERVICE: 'LEADERBOARD_SERVICE',
};
