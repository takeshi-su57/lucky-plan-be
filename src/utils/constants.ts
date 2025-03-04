import { etherUnits } from 'viem';

export const USDCCollateralIndex = {
  137: 3,
  8453: 1,
  42161: 3,
  421614: 3,
};
export const CloseMissionAction = 'CloseMissionAction';

export const SUBSCRIPTION_TOKEN = {
  botUpdated: 'botUpdated',
  missionAdded: 'missionAdded',
  missionUpdated: 'missionUpdated',
  taskAdded: 'taskAdded',
  taskUpdated: 'taskUpdated',
  followerDetailsUpdated: 'followerDetailsUpdated',
};

export const MIN_GAS = BigInt(0.0005 * Math.pow(10, etherUnits.wei));
export const MAX_GAS = BigInt(0.001 * Math.pow(10, etherUnits.wei));
