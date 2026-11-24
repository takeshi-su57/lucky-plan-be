import { NestFactory } from '@nestjs/core';

import { GnsConfigModule } from 'src/web3/platform/gns/gns-config.module';
import { GnsConfigService } from 'src/web3/platform/gns/gns-config.service';

async function main() {
  const app = await NestFactory.createApplicationContext(GnsConfigModule);

  try {
    const reports = await app.get(GnsConfigService).generateSnapshot();
    let failed = false;

    for (const report of reports) {
      const head = `[${report.chainId} ${report.network}]`;

      if (report.error) {
        failed = true;
        console.error(
          `${head} FAILED, kept previous snapshot: ${report.error}`,
        );
        continue;
      }

      console.log(
        `${head} ${report.pairs} pairs, ${report.collaterals} collaterals`,
      );

      if (report.addedPairs.length > 0) {
        console.log(`  added: ${report.addedPairs.join(', ')}`);
      }

      if (report.renamedPairs.length > 0) {
        console.log(`  renamed: ${report.renamedPairs.join(', ')}`);
      }
    }

    process.exitCode = failed ? 1 : 0;
  } finally {
    await app.close();
  }
}

main();
