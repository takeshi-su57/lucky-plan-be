import 'dotenv/config';
import { resolve } from 'path';

import {
  exportCacheSnapshot,
  importCacheSnapshot,
} from './microservices/simulationEvaluatorWorker/simulation-evaluator-worker-cache-snapshot';

async function main() {
  const [command, option, path] = process.argv.slice(2);
  if (!['export', 'import'].includes(command) || option !== '--file' || !path) {
    throw new Error(
      'Usage: cache-snapshot <export|import> --file <snapshot.zip>',
    );
  }
  const file = resolve(path);
  if (command === 'export') await exportCacheSnapshot(file);
  else await importCacheSnapshot(file);
  console.log(`Cache snapshot ${command} completed: ${file}`);
}

void main();
