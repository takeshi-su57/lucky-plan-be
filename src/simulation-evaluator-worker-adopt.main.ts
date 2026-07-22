import 'dotenv/config';

import { adoptPrebuiltCache } from './microservices/simulationEvaluatorWorker/simulation-evaluator-worker-cache-adoption';

if (process.argv.slice(2).length > 0) {
  throw new Error('Usage: worker-adopt');
}

void adoptPrebuiltCache();
