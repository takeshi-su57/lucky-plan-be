import { Action } from 'src/microservices/apiService/modules/actions/entities/action.entity';
import { BotDetails } from 'src/microservices/apiService/modules/bots/entities/bot.entity';
import { Mission } from 'src/microservices/apiService/modules/missions/entities/mission.entity';
import { TaskDetails } from 'src/microservices/apiService/modules/tasks/entities/task.entity';

export type TradeEvent<T> = {
  eventName: string;
  args: T;
};

export type BotContext = {
  bot: BotDetails;
};

export type MissionContext = BotContext & {
  mission: Mission;
};

export type TaskContext = MissionContext & {
  task: TaskDetails;
};

export type ActionContext<T> = {
  action: Action;
  context: T;
};

export type TradeEventContext<TEventArgs, TContext> = {
  action: Action;
  event: TradeEvent<TEventArgs>;
  context: TContext;
};

export type CloseMissionActionArgs = {
  expectedPrice: string;
};

export type OpenMissionActionArgs = {
  pairIndex: number;
  collateralAmountUSDC: string;
  leverage: number;
  long: boolean;
  openPrice: string;
  tp: string;
  sl: string;
};

export enum ServiceStatus {
  READY = 'ready',
  PROCESS = 'process',
  PAUSED = 'paused',
  KILLED = 'killed',
}

export type EncryptedData = {
  ivHex: string;
  encrypted: string;
};

export enum ChainPriority {
  HIGH = 'high',
  MEDIUM = 'medium',
  LOW = 'low',
}
