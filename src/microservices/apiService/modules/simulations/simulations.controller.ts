import {
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Param,
  ParseIntPipe,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import { PubSub } from 'graphql-subscriptions';
import { AuthGuard } from '@nestjs/passport';
import { Request, Response } from 'express';
import { UserPermission } from 'generated/prisma/client';

import { PUB_SUB } from 'src/global/global.module';
import { PATTERNS, SUBSCRIPTION_TOKEN } from 'src/utils/constants';
import {
  Simulation,
  SimulationPlan,
  SimulationResearch,
} from './entities/simulations.entity';
import { SimulationResearchReportService } from './simulation-research-report.service';

@Controller()
export class SimulationsController {
  constructor(
    @Inject(PUB_SUB) private readonly pubSub: PubSub,
    private readonly simulationResearchReportService: SimulationResearchReportService,
  ) {}

  @Get('simulation-researches/:id/reports/ai')
  @UseGuards(AuthGuard('jwt'))
  async downloadAiReport(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: Request & { user?: { permission?: UserPermission } },
    @Res() response: Response,
  ) {
    // The route is protected by the JWT guard. Keep exports restricted to the
    // same operational roles that can create and manage simulations.
    if (
      request.user?.permission !== UserPermission.Admin &&
      request.user?.permission !== UserPermission.Trader
    ) {
      throw new ForbiddenException(
        'A Trader or Admin role is required to export research',
      );
    }
    const report =
      await this.simulationResearchReportService.buildAiStandardZip(id);
    response
      .status(200)
      .set({
        'Content-Type': 'application/zip',
        'Content-Length': report.length.toString(),
        'Content-Disposition': `attachment; filename="simulation-research-${id}-ai-standard.zip"`,
      })
      .end(report);
  }

  @EventPattern(PATTERNS.Simulations.SimulationResearchUpdated)
  async handleSimulationResearchUpdated(
    @Payload() simulationResearch: SimulationResearch,
  ) {
    await this.pubSub.publish(SUBSCRIPTION_TOKEN.simulationResearchUpdated, {
      [SUBSCRIPTION_TOKEN.simulationResearchUpdated]: simulationResearch,
    });
  }

  @EventPattern(PATTERNS.Simulations.SimulationUpdated)
  async handleSimulationUpdated(@Payload() simulation: Simulation) {
    await this.pubSub.publish(SUBSCRIPTION_TOKEN.simulationUpdated, {
      [SUBSCRIPTION_TOKEN.simulationUpdated]: simulation,
    });
  }

  @EventPattern(PATTERNS.Simulations.SimulationPlanUpdated)
  async handleSimulationPlanUpdated(@Payload() simulationPlan: SimulationPlan) {
    await this.pubSub.publish(SUBSCRIPTION_TOKEN.simulationPlanUpdated, {
      [SUBSCRIPTION_TOKEN.simulationPlanUpdated]: simulationPlan,
    });
  }
}
