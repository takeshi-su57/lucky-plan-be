import { NestFactory } from '@nestjs/core';

import { AvntModule } from 'src/web3/platform/avnt/avnt.module';
import { AvntConfigService } from 'src/web3/platform/avnt/avnt-config.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AvntModule);

  try {
    const report = await app.get(AvntConfigService).generateSnapshot();

    console.log(`[8453 Base] ${report.pairs} pairs`);

    if (report.addedPairs.length > 0) {
      console.log(`  added: ${report.addedPairs.join(', ')}`);
    }

    if (report.renamedPairs.length > 0) {
      console.log(`  renamed: ${report.renamedPairs.join(', ')}`);
    }
  } catch (error) {
    console.error(
      `[8453 Base] FAILED, kept previous snapshot: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

main();
