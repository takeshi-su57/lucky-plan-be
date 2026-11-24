/// <reference types="node" />
import { generateGmxV2ConfigSnapshot } from 'src/web3/platform/gmx/v2/gmx-v2-config';

async function main() {
  const reports = await generateGmxV2ConfigSnapshot();
  let failed = false;

  for (const report of reports) {
    const head = `[${report.chainId}]`;

    if (report.error) {
      failed = true;
      console.error(`${head} FAILED, kept previous snapshot: ${report.error}`);
      continue;
    }

    console.log(`${head} ${report.markets} markets, ${report.tokens} tokens`);

    if (report.addedTokens.length > 0) {
      console.log(`  added tokens: ${report.addedTokens.join(', ')}`);
    }

    if (report.addedMarkets.length > 0) {
      console.log(`  added markets: ${report.addedMarkets.join(', ')}`);
    }

    if (report.skippedMarkets.length > 0) {
      console.log(`  skipped: ${report.skippedMarkets.join(', ')}`);
    }
  }

  process.exitCode = failed ? 1 : 0;
}

main();
