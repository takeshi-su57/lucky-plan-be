import { PrismaClient } from '@prisma/client';
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

  console.log('password metadata: ', password);
  console.log('availableChainIds metadata: ', availableChainIds);

  const strategyMetadata = [
    {
      key: 'equalCopy',
      title: 'Equal Copy',
      description: 'This strategy copys exactly same amount with leaders.',
    },
    {
      key: 'ratioCopy',
      title: 'Ratio Copy',
      description:
        'This strategy copys exactly same ratio with leaders. If you select 1 ratio then it can be a equal copy',
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
