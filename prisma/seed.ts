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
      value: '[137,42161,421614,8453]',
    },
  });

  const lastPnlSnapshotUpdatedTimestamp = await prisma.metadata.upsert({
    where: { key: 'lastPnlSnapshotUpdatedTimestamp' },
    update: {},
    create: {
      key: 'lastPnlSnapshotUpdatedTimestamp',
      value: '0',
    },
  });

  console.log('password metadata: ', password);
  console.log('availableChainIds metadata: ', availableChainIds);
  console.log(
    'lastPnlSnapshotUpdatedTimestamp: ',
    lastPnlSnapshotUpdatedTimestamp,
  );

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
      lastBlockNumber: 51941480,
      status: ContractStatus.Live,
    },
    {
      chainId: 8453,
      address: '0x6cd5ac19a07518a8092eeffda4f1174c72704eeb',
      description: 'This is a gains base chain gnsDiamondContract address',
      lastBlockNumber: 23360108,
      status: ContractStatus.Live,
    },
    {
      chainId: 42161,
      address: '0xff162c694eaa571f685030649814282ea457f169',
      description: 'This is a gains arbitrum chain gnsDiamondContract address',
      lastBlockNumber: 167122054,
      status: ContractStatus.Live,
    },
    {
      chainId: 421614,
      address: '0xd659a15812064c79e189fd950a189b15c75d3186',
      description:
        'This is a gains arbitrum sepolia chain gnsDiamondContract address.',
      lastBlockNumber: 33946165,
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
