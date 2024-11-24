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
