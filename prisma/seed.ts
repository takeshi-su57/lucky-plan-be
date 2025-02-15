import { ContractStatus, PrismaClient } from '@prisma/client';
import 'dotenv';

const prisma = new PrismaClient();

async function main() {
  const password = await prisma.metadata.upsert({
    where: { key: 'password' },
    update: {},
    create: {
      key: 'password',
      value: 'init',
    },
  });

  if (process.env.MNEMONIC) {
    const mnemonic = await prisma.metadata.upsert({
      where: { key: 'mnemonic' },
      update: {},
      create: {
        key: 'mnemonic',
        value: process.env.MNEMONIC,
      },
    });

    console.log('mnemonic metadata: ', mnemonic);
  }
  const availableChainIds = await prisma.metadata.upsert({
    where: { key: 'availableChainIds' },
    update: {},
    create: {
      key: 'availableChainIds',
      value: '[137,42161,421614,8453,33139]',
    },
  });

  console.log('password metadata: ', password);
  console.log('availableChainIds metadata: ', availableChainIds);

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
      chainId: 137,
      address: '0x209a9a01980377916851af2ca075c2b170452018',
      description: 'This is a gains polygon chain gnsDiamondContract address',
      lastBlockNumber: 62908499,
      lastLeaderboardBlockNumber: 62908499,
      backendUrl: 'https://backend-polygon.gains.trade',
      status: ContractStatus.Live,
    },
    {
      chainId: 8453,
      address: '0x6cd5ac19a07518a8092eeffda4f1174c72704eeb',
      description: 'This is a gains base chain gnsDiamondContract address',
      lastBlockNumber: 23360263,
      lastLeaderboardBlockNumber: 23360263,
      backendUrl: 'https://backend-base.gains.trade',
      status: ContractStatus.Live,
    },
    {
      chainId: 42161,
      address: '0xff162c694eaa571f685030649814282ea457f169',
      description: 'This is a gains arbitrum chain gnsDiamondContract address',
      lastBlockNumber: 262719377,
      lastLeaderboardBlockNumber: 262719377,
      backendUrl: 'https://backend-arbitrum.gains.trade',
      status: ContractStatus.Live,
    },
    {
      chainId: 421614,
      address: '0xd659a15812064c79e189fd950a189b15c75d3186',
      description:
        'This is a gains arbitrum sepolia chain gnsDiamondContract address.',
      lastBlockNumber: 104095908,
      lastLeaderboardBlockNumber: 104095908,
      backendUrl: 'https://backend-sepolia.gains.trade',
      status: ContractStatus.Live,
    },
    {
      chainId: 33139,
      address: '0x2BE5D7058AdBa14Bc38E4A83E94A81f7491b0163',
      description:
        'This is a gains ape chain chain gnsDiamondContract address.',
      lastBlockNumber: 4810548,
      lastLeaderboardBlockNumber: 4810548,
      backendUrl: 'https://backend-apechain.gains.trade',
      status: ContractStatus.Live,
    },
  ];

  for (const data of contractData) {
    const result = await prisma.contract.upsert({
      where: {
        chainId_address: {
          chainId: data.chainId,
          address: data.address,
        },
      },
      update: {},
      create: data,
    });

    console.log('contract data:', result);
  }

  const tagsData = [
    {
      tag: 'LEADER',
      color: '#047857',
      description: 'This is leader.',
    },
    {
      tag: 'FOLLOWER',
      color: '#6b21a8',
      description: 'This is follower.',
    },
  ];

  for (const data of tagsData) {
    const result = await prisma.tag.upsert({
      where: {
        tag: data.tag,
      },
      update: {},
      create: data,
    });

    console.log('Tags:', result);
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
