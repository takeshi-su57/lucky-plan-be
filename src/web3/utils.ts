import { Platform, Version } from '@prisma/client';

import { gnsMultiCollatDiamondAbi as gnsV10Abi } from 'src/web3/platform/gns/v10/abi/GNSMultiCollatDiamond';
import { gnsMultiCollatDiamondAbi as gnsV9Abi } from 'src/web3/platform/gns/v9/abi/GNSMultiCollatDiamond';
import { EventEmitterAbi as gmxV2Abi } from 'src/web3/platform/gmx/v2/abi/EventEmitter';
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
  eventParsers as eventParsersForGMX,
  isOpenMissionAction as isOpenMissionActionForGMX,
  isCloseMissionAction as isCloseMissionActionForGMX,
  eventToActionParser as eventToActionParserForGMX,
  eventToPerpTradeHistory as eventToPerpTradeHistoryForGMX,
} from 'src/web3/platform/gmx/v2/eventParsers';
import {
  eventParsers as eventParsersForAVNT,
  isOpenMissionAction as isOpenMissionActionForAVNT,
  isCloseMissionAction as isCloseMissionActionForAVNT,
  eventToActionParser as eventToActionParserForAVNT,
  eventToPerpTradeHistory as eventToPerpTradeHistoryForAVNT,
} from 'src/web3/platform/avnt/v1/eventParsers';
import { avntGeneralAbi } from './platform/avnt/v1/abi/AvntGeneral';

const gnsV10EventSignatures: Record<string, string> = Object.fromEntries(
  gnsV10Abi
    .filter((item) => item.type === 'event')
    .map((item) => [item.signature, item.name]),
);

const gnsV9EventSignatures: Record<string, string> = Object.fromEntries(
  gnsV9Abi
    .filter((item) => item.type === 'event')
    .map((item) => [item.signature, item.name]),
);

const gnsV9PerpTradeEventNames = eventParsersV9.map((item) => item.eventName);
const gnsV10PerpTradeEventNames = eventParsersV10.map((item) => item.eventName);
const gmxV2PerpTradeEventNames = eventParsersForGMX.map(
  (item) => item.eventName,
);
const avntV1PerpTradeEventNames = eventParsersForAVNT.map(
  (item) => item.eventName,
);

const info = {
  [Platform.GNS]: {
    [Version.V9]: {
      tradeEventNames: gnsV9PerpTradeEventNames,
      eventSignatures: gnsV9EventSignatures,
      eventToActionParser: eventToActionParserV9,
      isOpenMissionAction: isOpenMissionActionV9,
      isCloseMissionAction: isCloseMissionActionV9,
      abi: gnsV9Abi,
      eventToPerpTradeHistory: eventToPerpTradeHistoryV9,
    },
    [Version.V10]: {
      tradeEventNames: gnsV10PerpTradeEventNames,
      eventSignatures: gnsV10EventSignatures,
      eventToActionParser: eventToActionParserV10,
      isOpenMissionAction: isOpenMissionActionV10,
      isCloseMissionAction: isCloseMissionActionV10,
      abi: gnsV10Abi,
      eventToPerpTradeHistory: eventToPerpTradeHistoryV10,
    },
  },
  [Platform.GMX]: {
    [Version.V2]: {
      tradeEventNames: gmxV2PerpTradeEventNames,
      eventSignatures: null,
      eventToActionParser: eventToActionParserForGMX,
      isOpenMissionAction: isOpenMissionActionForGMX,
      isCloseMissionAction: isCloseMissionActionForGMX,
      abi: gmxV2Abi,
      eventToPerpTradeHistory: eventToPerpTradeHistoryForGMX,
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
    },
  },
};

export function getWeb3Info(platform: Platform, version: Version) {
  if (platform === Platform.GNS) {
    if (version === Version.V9 || version === Version.V10) {
      return info[Platform.GNS][version];
    } else {
      throw new Error('Invalid version');
    }
  }

  if (platform === Platform.GMX) {
    if (version === Version.V2) {
      return info[Platform.GMX][version];
    } else {
      throw new Error('Invalid version');
    }
  }

  if (platform === Platform.AVNT) {
    if (version === Version.V1) {
      return info[Platform.AVNT][version];
    } else {
      throw new Error('Invalid version');
    }
  }

  throw new Error('Invalid platform');
}
