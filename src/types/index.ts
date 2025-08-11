import { ActionDetails } from 'src/microservices/apiService/modules/actions/entities/action.entity';
import { BotDetails } from 'src/microservices/apiService/modules/bots/entities/bot.entity';
import { TaskDetails } from 'src/microservices/apiService/modules/tasks/entities/task.entity';
import { MissionDetails } from 'src/microservices/apiService/modules/missions/entities/mission.entity';

export type TradeEvent<T> = {
  eventName: string;
  args: T;
};

export type BotContext = {
  bot: BotDetails;
};

export type MissionContext = BotContext & {
  mission: MissionDetails;
};

export type TaskContext = MissionContext & {
  task: TaskDetails;
};

export type ActionContext<T> = {
  action: ActionDetails;
  context: T;
};

export type TradeEventContext<TEventArgs, TContext> = {
  action: ActionDetails;
  event: TradeEvent<TEventArgs>;
  context: TContext;
};

export type CloseMissionActionArgs = {
  expectedPrice: string;
};

export enum ServiceStatus {
  KILLED = 'killed',
  PROCESS = 'process',
  READY = 'ready',
}

export type EncryptedData = {
  ivHex: string;
  encrypted: string;
};
