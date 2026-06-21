import { Contract } from 'generated/prisma/client';

import { ActionContext, BotContext, MissionContext } from 'src/types';
import { Mission } from 'src/microservices/apiService/modules/missions/entities/mission.entity';

import { ContractActionBatch, ContractActionItem } from './copy-trading.types';

export abstract class CopyTradingModule {
  abstract runOnchainEventListenerCron(): Promise<void>;
  abstract runTaskExecutorCron(): Promise<void>;
  abstract run(): Promise<void>;
}

export abstract class ContractMonitor {
  abstract scanAllContracts(): Promise<ContractActionBatch[]>;
  abstract scanContract(contract: Contract): Promise<ContractActionBatch[]>;
  abstract markContractBatchScanned(batch: ContractActionBatch): Promise<void>;
}

export abstract class ActionRouter {
  abstract loadContext(): Promise<void>;

  abstract routeLeaderActionItems(
    contract: Contract,
    blockNumber: number,
    actionItems: ContractActionItem[],
  ): Promise<void>;

  abstract routeFollowerActionItems(
    contract: Contract,
    blockNumber: number,
    actionItems: ContractActionItem[],
  ): Promise<void>;
}

export abstract class MissionRouter {
  abstract routeLeaderBotActions(
    actions: ActionContext<BotContext>[],
  ): Promise<void>;

  abstract routeFollowerBotActions(
    actions: ActionContext<BotContext>[],
  ): Promise<void>;
}

export type FollowerTaskCallbacks = {
  closeCancelded: (missionIds: number[]) => Promise<void>;
  openCanceled: (missionIds: number[]) => Promise<void>;
  clone: (missions: Mission[]) => Promise<void>;
};

export abstract class TaskLifecycle {
  abstract handleLeaderMissionActions(
    actions: ActionContext<MissionContext>[],
    missionCloseCallback: (missionIds: number[]) => Promise<void>,
  ): Promise<void>;

  abstract handleFollowerMissionActions(
    actions: ActionContext<MissionContext>[],
    callbacks: FollowerTaskCallbacks,
  ): Promise<void>;
}

export abstract class CopyTradingTaskExecutor {
  abstract executeAvailableTasks(): Promise<void>;
  abstract reconcileFailedTasks(): Promise<void>;
  abstract reconcileAwaitTasks(): Promise<void>;
}
