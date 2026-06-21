import { Contract } from 'generated/prisma/client';
import { ActionItem } from 'src/microservices/apiService/modules/actions/entities/action.entity';

export type ContractActionItem = {
  item: ActionItem;
  blockNumber: number;
  logIndex: number;
  blockHash?: string | null;
  txHash?: string | null;
};

export type ContractActionBatch = {
  contract: Contract;
  blockNumber: number;
  actionItems: ContractActionItem[];
};
