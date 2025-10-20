import {
  ContractStatus,
  Platform,
  PrismaClient,
  Version,
} from '@prisma/client';
import 'dotenv';

const prisma = new PrismaClient();

async function main() {
  const strategyMetadata = [
    {
      key: 'ratioCopy',
      title: 'Ratio Copy',
      description:
        'This strategy copys exactly same ratio with leaders. If you select 1 ratio then it can be a equal copy',
    },
    {
      key: 'scaleCopy',
      title: 'Scale Copy',
      description: 'This strategy copys exactly same scale with leaders.',
    },
  ];

  for (const data of strategyMetadata) {
    const result = await prisma.strategyMetadata.upsert({
      where: {
        key: data.key,
      },
      update: {},
      create: data,
    });

    console.log('Strategy Metadata:', result);
  }

  const contractData = [
    {
      platform: Platform.GNS,
      version: Version.V9,
      chainId: 137,
      address: '0x209a9a01980377916851af2ca075c2b170452018',
      description: 'This is a gains polygon chain gnsDiamondContract address',
      fromBlock: 62908499,
      toBlock: 74793869,
      lastBlockNumber: 62908499,
      lastLeaderboardBlockNumber: 62908499,
      backendUrl: 'https://backend-polygon.gains.trade',
      status: ContractStatus.Dead,
      isTestnet: false,
    },
    {
      platform: Platform.GNS,
      version: Version.V9,
      chainId: 8453,
      address: '0x6cd5ac19a07518a8092eeffda4f1174c72704eeb',
      description: 'This is a gains base chain gnsDiamondContract address',
      fromBlock: 23360263,
      toBlock: 33765880,
      lastBlockNumber: 23360263,
      lastLeaderboardBlockNumber: 23360263,
      backendUrl: 'https://backend-base.gains.trade',
      status: ContractStatus.Dead,
      isTestnet: false,
    },
    {
      platform: Platform.GNS,
      version: Version.V9,
      chainId: 42161,
      address: '0xff162c694eaa571f685030649814282ea457f169',
      description: 'This is a gains arbitrum chain gnsDiamondContract address',
      fromBlock: 262719377,
      toBlock: 364917632,
      lastBlockNumber: 262719377,
      lastLeaderboardBlockNumber: 262719377,
      backendUrl: 'https://backend-arbitrum.gains.trade',
      status: ContractStatus.Dead,
      isTestnet: false,
    },
    {
      platform: Platform.GNS,
      version: Version.V9,
      chainId: 421614,
      address: '0xd659a15812064c79e189fd950a189b15c75d3186',
      description:
        'This is a gains arbitrum sepolia chain gnsDiamondContract address.',
      fromBlock: 104095908,
      toBlock: 179251082,
      lastBlockNumber: 104095908,
      lastLeaderboardBlockNumber: 104095908,
      backendUrl: 'https://backend-sepolia.gains.trade',
      status: ContractStatus.Dead,
      isTestnet: true,
    },
    {
      platform: Platform.GNS,
      version: Version.V9,
      chainId: 33139,
      address: '0x2be5d7058adba14bc38e4a83e94a81f7491b0163',
      description:
        'This is a gains ape chain chain gnsDiamondContract address.',
      fromBlock: 4810548,
      toBlock: 20196285,
      lastBlockNumber: 4810548,
      lastLeaderboardBlockNumber: 4810548,
      backendUrl: 'https://backend-apechain.gains.trade',
      status: ContractStatus.Dead,
      isTestnet: false,
    },
    {
      platform: Platform.GNS,
      version: Version.V10,
      chainId: 137,
      address: '0x209a9a01980377916851af2ca075c2b170452018',
      description: 'This is a gains polygon chain gnsDiamondContract address',
      fromBlock: 74793870,
      toBlock: 0,
      lastBlockNumber: 74793870,
      lastLeaderboardBlockNumber: 74793870,
      backendUrl: 'https://backend-polygon.gains.trade',
      status: ContractStatus.Dead,
      isTestnet: false,
    },
    {
      platform: Platform.GNS,
      version: Version.V10,
      chainId: 8453,
      address: '0x6cd5ac19a07518a8092eeffda4f1174c72704eeb',
      description: 'This is a gains base chain gnsDiamondContract address',
      fromBlock: 33765881,
      toBlock: 0,
      lastBlockNumber: 33765881,
      lastLeaderboardBlockNumber: 33765881,
      backendUrl: 'https://backend-base.gains.trade',
      status: ContractStatus.Dead,
      isTestnet: false,
    },
    {
      platform: Platform.GNS,
      version: Version.V10,
      chainId: 42161,
      address: '0xff162c694eaa571f685030649814282ea457f169',
      description: 'This is a gains arbitrum chain gnsDiamondContract address',
      fromBlock: 364917633,
      toBlock: 0,
      lastBlockNumber: 364917633,
      lastLeaderboardBlockNumber: 364917633,
      backendUrl: 'https://backend-arbitrum.gains.trade',
      status: ContractStatus.Dead,
      isTestnet: false,
    },
    {
      platform: Platform.GNS,
      version: Version.V10,
      chainId: 421614,
      address: '0xd659a15812064c79e189fd950a189b15c75d3186',
      description:
        'This is a gains arbitrum sepolia chain gnsDiamondContract address.',
      fromBlock: 179251083,
      toBlock: 0,
      lastBlockNumber: 179251083,
      lastLeaderboardBlockNumber: 179251083,
      backendUrl: 'https://backend-sepolia.gains.trade',
      status: ContractStatus.Dead,
      isTestnet: true,
    },
    {
      platform: Platform.GNS,
      version: Version.V10,
      chainId: 33139,
      address: '0x2be5d7058adba14bc38e4a83e94a81f7491b0163',
      description:
        'This is a gains ape chain chain gnsDiamondContract address.',
      fromBlock: 20196286,
      toBlock: 0,
      lastBlockNumber: 20196286,
      lastLeaderboardBlockNumber: 20196286,
      backendUrl: 'https://backend-apechain.gains.trade',
      status: ContractStatus.Dead,
      isTestnet: false,
    },
    {
      platform: Platform.GMX,
      version: Version.V2,
      chainId: 42161,
      address: '0xc8ee91a54287db53897056e12d9819156d3822fb',
      description: 'GMX V2 Event Emitter on Arbitrum',
      fromBlock: 107737756,
      toBlock: 0,
      lastBlockNumber: 107737756,
      lastLeaderboardBlockNumber: 107737756,
      backendUrl: '',
      status: ContractStatus.Dead,
      isTestnet: false,
    },
    {
      platform: Platform.GMX,
      version: Version.V2,
      chainId: 43114,
      address: '0xdb17b211c34240b014ab6d61d4a31fa0c0e20c26',
      description: 'GMX V2 Event Emitter on Avalanche',
      fromBlock: 32162455,
      toBlock: 0,
      lastBlockNumber: 32162455,
      lastLeaderboardBlockNumber: 32162455,
      backendUrl: '',
      status: ContractStatus.Dead,
      isTestnet: false,
    },
    {
      platform: Platform.AVNT,
      version: Version.V1,
      chainId: 8453,
      address: '0x0c16ff40065cc3ab4bc55b60e447504afb9c7970',
      description: 'Avnt V1 TradingCallback on Base',
      fromBlock: 26237562,
      toBlock: 0,
      lastBlockNumber: 26237562,
      lastLeaderboardBlockNumber: 26237562,
      backendUrl: '',
      status: ContractStatus.Dead,
      isTestnet: false,
    },
  ];

  for (const data of contractData) {
    const result = await prisma.contract.upsert({
      where: {
        chainId_address_version_platform: {
          chainId: data.chainId,
          address: data.address,
          version: data.version,
          platform: data.platform,
        },
      },
      update: {},
      create: data,
    });

    console.log('contract data:', result);
  }
}
main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
