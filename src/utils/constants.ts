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
  GnsV9: {
    OpenTrade: 'OPEN_TRADE',
    CloseTradeMarket: 'CLOSE_TRADE_MARKET',
    CancelOrderAfterTimeout: 'CANCEL_ORDER_AFTER_TIMEOUT',
    UpdateTp: 'UPDATE_TP',
    UpdateSl: 'UPDATE_SL',
    UpdateLeverage: 'UPDATE_LEVERAGE',
    IncreasePositionSize: 'INCREASE_POSITION_SIZE',
    DecreasePositionSize: 'DECREASE_POSITION_SIZE',
    UpdateMaxClosingSlippageP: 'UPDATE_MAX_CLOSING_SLIPPAGE_P',
    GetPendingOrders: 'GET_PENDING_ORDERS',
    GetTrades: 'GET_TRADES',
    GetTrade: 'GET_TRADE',
    GetTradingVariable: 'GET_TRADING_VARIABLE',
    GetCollateralPrice: 'GET_COLLATERAL_PRICE',
  },
  Web3: {
    Erc20Transfer: 'ERC20_TRANSFER',
    Erc20Balance: 'ERC20_BALANCE',
    Erc20Allowance: 'ERC20_ALLOWANCE',
    Erc20Approve: 'ERC20_APPROVE',
    NativeTransfer: 'NATIVE_TRANSFER',
    NativeBalance: 'NativeBalance',
    WaitForTransactionReceipt: 'WAIT_FOR_TRANSACTION_RECEIPT',
    EstimateGas: 'ESTIMATE_GAS',
    EstimateFeesPerGas: 'ESTIMATE_FEES_PER_GAS',
    GetBlockNumber: 'GET_BLOCK_NUMBER',
    GetBlock: 'GET_BLOCK',
    GetLogs: 'GET_LOGS',
  },
};

export const SERVICE_NAMES = {
  REDIS_SERVICE: 'REDIS_SERVICE',
  API_SERVICE: 'API_SERVICE',
  LEADERBOARD_SERVICE: 'LEADERBOARD_SERVICE',
  TRADING_SERVICE: 'TRADING_SERVICE',
  WEB3_SERVICE: 'WEB3_SERVICE',
};
