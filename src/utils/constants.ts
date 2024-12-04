import { etherUnits } from 'viem';

export const USDCCollateralIndex = 3;
export const CloseMissionAction = 'CloseMissionAction';

export const SUBSCRIPTION_TOKEN = {
  missionAdded: 'missionAdded',
  missionUpdated: 'missionUpdated',
  taskAdded: 'taskAdded',
  taskUpdated: 'taskUpdated',
  actionAdded: 'actionAdded',
  followerActionAdded: 'followerActionAdded',
  followerDetailsUpdated: 'followerDetailsUpdated',
};

export const MIN_GAS = BigInt(0.003 * Math.pow(10, etherUnits.wei));
export const MAX_GAS = BigInt(0.01 * Math.pow(10, etherUnits.wei));
