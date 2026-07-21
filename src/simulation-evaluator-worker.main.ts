import { NestFactory } from '@nestjs/core';
import 'dotenv/config';

import { SimulationEvaluatorWorkerModule } from './microservices/simulationEvaluatorWorker/simulation-evaluator-worker.module';

void NestFactory.createApplicationContext(SimulationEvaluatorWorkerModule);
