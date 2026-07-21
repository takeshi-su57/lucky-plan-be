import 'dotenv/config';
import { Platform } from 'generated/prisma/client';
import { PrismaService } from 'src/global/prisma.service';
import { PnlSnapshotFileCacheService } from 'src/microservices/apiService/modules/trade-histories/pnl-snapshot-file-cache.service';

interface Options {
  dateStr?: string;
  force: boolean;
  platform?: Platform;
}

function getOptions(args: string[]): Options {
  const options: Options = { force: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--force') options.force = true;
    else if (argument === '--platform') {
      const platform = args[++index];
      if (
        !platform ||
        !Object.values(Platform).includes(platform as Platform)
      ) {
        throw new Error(`Invalid platform: ${platform ?? ''}`);
      }
      options.platform = platform as Platform;
    } else if (argument === '--date') {
      const dateStr = args[++index];
      if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        throw new Error(`Invalid date: ${dateStr ?? ''}`);
      }
      options.dateStr = dateStr;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

async function main() {
  const options = getOptions(process.argv.slice(2));
  const prisma = new PrismaService();
  const cache = new PnlSnapshotFileCacheService(prisma);

  await prisma.$connect();
  try {
    const snapshots = await prisma.pnlSnapshotV2InitializedFlag.findMany({
      where: {
        isInit: true,
        platform: options.platform,
        dateStr: options.dateStr,
      },
      select: { platform: true, dateStr: true },
      orderBy: [{ platform: 'asc' }, { dateStr: 'asc' }],
    });

    if (snapshots.length === 0) {
      console.log('No initialized PnlSnapshotV2 records matched.');
      return;
    }

    for (const [index, snapshot] of snapshots.entries()) {
      if (
        !options.force &&
        (await cache.exists(snapshot.platform, snapshot.dateStr))
      ) {
        console.log(
          `[${index + 1}/${snapshots.length}] skipped ${snapshot.platform} ${snapshot.dateStr}`,
        );
        continue;
      }

      console.log(
        `[${index + 1}/${snapshots.length}] exporting ${snapshot.platform} ${snapshot.dateStr}`,
      );
      await cache.publish(snapshot.platform, snapshot.dateStr);
      console.log(
        `[${index + 1}/${snapshots.length}] complete ${snapshot.platform} ${snapshot.dateStr}`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
