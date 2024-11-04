import { PrismaClient } from '@prisma/client';

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
  const mnemonic = await prisma.metadata.upsert({
    where: { key: 'mnemonic' },
    update: {},
    create: {
      key: 'mnemonic',
      value: '',
    },
  });

  console.log('password metadata: ', password);
  console.log('mnemonic metadata: ', mnemonic);
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
