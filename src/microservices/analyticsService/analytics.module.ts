import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

import { GlobalModule } from 'src/global/global.module';
import { TradeHistoriesModule } from '../apiService/modules/trade-histories/trade-histories.module';
import { AnalyticsController } from './analytics.controller';
import { LeaderboardModule } from './modules/leaderboard/leaderboard.module';
import { AnalyticsSimulationsModule } from './modules/simulations/analytics-simulations.module';
import { SimulationEvaluatorModule } from './modules/simulationEvaluator/simulation-evaluator.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    GlobalModule,
    TradeHistoriesModule,
    LeaderboardModule,
    AnalyticsSimulationsModule,
    SimulationEvaluatorModule,
  ],
  controllers: [AnalyticsController],
})
export class AnalyticsModule {}
