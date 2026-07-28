import { Platform, Version } from 'generated/prisma/client';
import { Abi, AbiEvent } from 'viem';

import { gnsLegacyTradingCallbacksAbi as gnsV6V7Abi } from 'src/web3/platform/gns/v6-v7/abi/GNSTradingCallbacks';
import { gnsV8V92MultiCollatDiamondAbi as gnsV8V92Abi } from 'src/web3/platform/gns/v8-v9.2/abi/GNSMultiCollatDiamond';
import { gnsMultiCollatDiamondAbi as gnsV10Abi } from 'src/web3/platform/gns/v10/abi/GNSMultiCollatDiamond';
import { gnsMultiCollatDiamondAbi as gnsV9Abi } from 'src/web3/platform/gns/v9/abi/GNSMultiCollatDiamond';
import { EventEmitterAbi as gmxV2Abi } from 'src/web3/platform/gmx/v2/abi/EventEmitter';
import {
  gmxV1EventSignatures,
  gmxV1VaultAbi,
} from 'src/web3/platform/gmx/v1/abi/Vault';
import {
  eventParsers as eventParsersV10,
  isOpenMissionAction as isOpenMissionActionV10,
  isCloseMissionAction as isCloseMissionActionV10,
  eventToActionParser as eventToActionParserV10,
  eventToPerpTradeHistory as eventToPerpTradeHistoryV10,
} from 'src/web3/platform/gns/v10/eventParsers';
import {
  eventParsers as eventParsersV9,
  isOpenMissionAction as isOpenMissionActionV9,
  isCloseMissionAction as isCloseMissionActionV9,
  eventToActionParser as eventToActionParserV9,
  eventToPerpTradeHistory as eventToPerpTradeHistoryV9,
} from 'src/web3/platform/gns/v9/eventParsers';
import {
  eventParsers as eventParsersForGMXV2,
  isOpenMissionAction as isOpenMissionActionForGMXV2,
  isCloseMissionAction as isCloseMissionActionForGMXV2,
  eventToActionParser as eventToActionParserForGMXV2,
  eventToPerpTradeHistory as eventToPerpTradeHistoryForGMXV2,
} from 'src/web3/platform/gmx/v2/eventParsers';
import {
  eventParsers as eventParsersForGMXV1,
  isOpenMissionAction as isOpenMissionActionForGMXV1,
  isCloseMissionAction as isCloseMissionActionForGMXV1,
  eventToActionParser as eventToActionParserForGMXV1,
  eventToPerpTradeHistory as eventToPerpTradeHistoryForGMXV1,
  normalizeGmxV1EventLogs,
} from 'src/web3/platform/gmx/v1/eventParsers';
import {
  eventParsers as eventParsersForAVNT,
  isOpenMissionAction as isOpenMissionActionForAVNT,
  isCloseMissionAction as isCloseMissionActionForAVNT,
  eventToActionParser as eventToActionParserForAVNT,
  eventToPerpTradeHistory as eventToPerpTradeHistoryForAVNT,
} from 'src/web3/platform/avnt/v1/eventParsers';
import { avntGeneralAbi } from './platform/avnt/v1/abi/AvntGeneral';

import {
  eventParsers as eventParsersV6V7,
  isOpenMissionAction as isOpenMissionActionV6V7,
  isCloseMissionAction as isCloseMissionActionV6V7,
  eventToActionParser as eventToActionParserV6V7,
  eventToPerpTradeHistory as eventToPerpTradeHistoryV6V7,
} from 'src/web3/platform/gns/v6-v7/eventParsers';
import {
  eventParsers as eventParsersV8V92,
  isOpenMissionAction as isOpenMissionActionV8V92,
  isCloseMissionAction as isCloseMissionActionV8V92,
  eventToActionParser as eventToActionParserV8V92,
  eventToPerpTradeHistory as eventToPerpTradeHistoryV8V92,
} from 'src/web3/platform/gns/v8-v9.2/eventParsers';

const gnsV10EventSignatures: Record<string, string> = Object.fromEntries(
  gnsV10Abi
    .filter((item) => item.type === 'event')
    .map((item) => [item.signature, item.name]),
);

const gnsV6V7EventSignatures: Record<string, string> = Object.fromEntries(
  gnsV6V7Abi
    .filter((item) => item.type === 'event')
    .map((item) => [item.signature, item.name]),
);
const gnsV8V92EventSignatures: Record<string, string> = Object.fromEntries(
  gnsV8V92Abi
    .filter((item) => item.type === 'event')
    .map((item) => [item.signature, item.name]),
);

const gnsV9EventSignatures: Record<string, string> = Object.fromEntries(
  gnsV9Abi
    .filter((item) => item.type === 'event')
    .map((item) => [item.signature, item.name]),
);

const gnsV9PerpTradeEventNames = eventParsersV9.map((item) => item.eventName);
const gnsV6V7PerpTradeEventNames = eventParsersV6V7.map(
  (item) => item.eventName,
);
const gnsV8V92PerpTradeEventNames = eventParsersV8V92.map(
  (item) => item.eventName,
);
const gnsV10PerpTradeEventNames = eventParsersV10.map((item) => item.eventName);
const gmxV1PerpTradeEventNames = eventParsersForGMXV1.map(
  (item) => item.eventName,
);
const gmxV2PerpTradeEventNames = eventParsersForGMXV2.map(
  (item) => item.eventName,
);
const avntV1PerpTradeEventNames = eventParsersForAVNT.map(
  (item) => item.eventName,
);

type Web3Info = {
  tradeEventNames: string[];
  eventSignatures: Record<string, string> | null;
  eventToActionParser: (event: any) => any;
  isOpenMissionAction: (action: any) => boolean;
  isCloseMissionAction: (action: any) => boolean;
  abi: Abi;
  eventToPerpTradeHistory: (chainId: number, event: any, address: string) => any;
  normalizeEventLogs: ((logs: any[]) => any[]) | null;
  logEvents: readonly AbiEvent[] | null;
};

const info: Record<Platform, Partial<Record<Version, Web3Info>>> = {
  [Platform.GNS]: {
    [Version.V6_V7]: {
      tradeEventNames: gnsV6V7PerpTradeEventNames,
      eventSignatures: gnsV6V7EventSignatures,
      eventToActionParser: eventToActionParserV6V7,
      isOpenMissionAction: isOpenMissionActionV6V7,
      isCloseMissionAction: isCloseMissionActionV6V7,
      abi: gnsV6V7Abi,
      eventToPerpTradeHistory: eventToPerpTradeHistoryV6V7,
      normalizeEventLogs: null,
      logEvents: null,
    },
    [Version.V8_V9_2]: {
      tradeEventNames: gnsV8V92PerpTradeEventNames,
      eventSignatures: gnsV8V92EventSignatures,
      eventToActionParser: eventToActionParserV8V92,
      isOpenMissionAction: isOpenMissionActionV8V92,
      isCloseMissionAction: isCloseMissionActionV8V92,
      abi: gnsV8V92Abi,
      eventToPerpTradeHistory: eventToPerpTradeHistoryV8V92,
      normalizeEventLogs: null,
      logEvents: null,
    },
    [Version.V9]: {
      tradeEventNames: gnsV9PerpTradeEventNames,
      eventSignatures: gnsV9EventSignatures,
      eventToActionParser: eventToActionParserV9,
      isOpenMissionAction: isOpenMissionActionV9,
      isCloseMissionAction: isCloseMissionActionV9,
      abi: gnsV9Abi,
      eventToPerpTradeHistory: eventToPerpTradeHistoryV9,
      normalizeEventLogs: null,
      logEvents: null,
    },
    [Version.V10]: {
      tradeEventNames: gnsV10PerpTradeEventNames,
      eventSignatures: gnsV10EventSignatures,
      eventToActionParser: eventToActionParserV10,
      isOpenMissionAction: isOpenMissionActionV10,
      isCloseMissionAction: isCloseMissionActionV10,
      abi: gnsV10Abi,
      eventToPerpTradeHistory: eventToPerpTradeHistoryV10,
      normalizeEventLogs: null,
      logEvents: null,
    },
  },
  [Platform.GMX]: {
    [Version.V1]: {
      tradeEventNames: gmxV1PerpTradeEventNames,
      eventSignatures: gmxV1EventSignatures,
      eventToActionParser: eventToActionParserForGMXV1,
      isOpenMissionAction: isOpenMissionActionForGMXV1,
      isCloseMissionAction: isCloseMissionActionForGMXV1,
      abi: gmxV1VaultAbi,
      eventToPerpTradeHistory: eventToPerpTradeHistoryForGMXV1,
      normalizeEventLogs: normalizeGmxV1EventLogs,
      logEvents: gmxV1VaultAbi,
    },
    [Version.V2]: {
      tradeEventNames: gmxV2PerpTradeEventNames,
      eventSignatures: null,
      eventToActionParser: eventToActionParserForGMXV2,
      isOpenMissionAction: isOpenMissionActionForGMXV2,
      isCloseMissionAction: isCloseMissionActionForGMXV2,
      abi: gmxV2Abi,
      eventToPerpTradeHistory: eventToPerpTradeHistoryForGMXV2,
      normalizeEventLogs: null,
      logEvents: null,
    },
  },
  [Platform.AVNT]: {
    [Version.V1]: {
      tradeEventNames: avntV1PerpTradeEventNames,
      eventSignatures: null,
      eventToActionParser: eventToActionParserForAVNT,
      isOpenMissionAction: isOpenMissionActionForAVNT,
      isCloseMissionAction: isCloseMissionActionForAVNT,
      abi: avntGeneralAbi,
      eventToPerpTradeHistory: eventToPerpTradeHistoryForAVNT,
      normalizeEventLogs: null,
      logEvents: null,
    },
  },
};

export function getWeb3Info(platform: Platform, version: Version) {
  if (platform === Platform.GNS) {
    if (
      version === Version.V6_V7 ||
      version === Version.V8_V9_2 ||
      version === Version.V9 ||
      version === Version.V10
    ) {
      return info[Platform.GNS][version] as Web3Info;
    } else {
      throw new Error('Invalid version');
    }
  }

  if (platform === Platform.GMX) {
    if (version === Version.V1 || version === Version.V2) {
      return info[Platform.GMX][version] as Web3Info;
    } else {
      throw new Error('Invalid version');
    }
  }

  if (platform === Platform.AVNT) {
    if (version === Version.V1) {
      return info[Platform.AVNT][version] as Web3Info;
    } else {
      throw new Error('Invalid version');
    }
  }

  throw new Error('Invalid platform');
}
