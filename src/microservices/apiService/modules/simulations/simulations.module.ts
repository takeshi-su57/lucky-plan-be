import { Module } from '@nestjs/common';

import { SimulationsService } from './simulations.service';
import { SimulationsResolver } from './simulations.resolver';
import { TradeHistoriesModule } from '../trade-histories/trade-histories.module';
import { SimulationPlansService } from './simulation-plans.service';
import { SimulationsController } from './simulations.controller';
import { SimulationResearchReportService } from './simulation-research-report.service';
import { SimulationEvaluatorModule } from 'src/microservices/analyticsService/modules/simulationEvaluator/simulation-evaluator.module';
import { SimulationEvaluatorGatewayController } from './simulation-evaluator-gateway.controller';
import { SimulationEvaluatorWorkerDataService } from './simulation-evaluator-worker-data.service';
import { SimulationEvaluatorWorkerAuthService } from './simulation-evaluator-worker-auth.service';
import { SimulationEvaluatorWorkersResolver } from './simulation-evaluator-workers.resolver';
import { SimulationEvaluatorGatewayLoggingInterceptor } from './simulation-evaluator-gateway-logging.interceptor';

@Module({
  imports: [TradeHistoriesModule, SimulationEvaluatorModule],
  controllers: [SimulationsController, SimulationEvaluatorGatewayController],
  providers: [
    SimulationsResolver,
    SimulationsService,
    SimulationPlansService,
    SimulationResearchReportService,
    SimulationEvaluatorWorkerDataService,
    SimulationEvaluatorWorkerAuthService,
    SimulationEvaluatorGatewayLoggingInterceptor,
    SimulationEvaluatorWorkersResolver,
  ],
  exports: [SimulationsService],
})
export class SimulationsModule {}
