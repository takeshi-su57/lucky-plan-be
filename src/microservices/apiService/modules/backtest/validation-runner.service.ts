import { Injectable, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ValidationPipelineStatus } from 'generated/prisma/client';

import { PrismaService } from 'src/global/prisma.service';
import { LogsService } from 'src/global/logs.service';
import { getReadableError } from 'src/utils';

import { ValidationPipelineService } from './validation-pipeline.service';
import { ThresholdFilterService } from './threshold-filter.service';
import { ParetoSelectionService } from './pareto-selection.service';
import { WalkForwardService } from './walk-forward.service';
import { RobustnessTestService } from './robustness-test.service';

@Injectable()
export class ValidationRunnerService implements OnModuleInit {
  private isProcessing = false;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly pipelineService: ValidationPipelineService,
    private readonly thresholdService: ThresholdFilterService,
    private readonly paretoService: ParetoSelectionService,
    private readonly wfaService: WalkForwardService,
    private readonly robustnessService: RobustnessTestService,
    private readonly logger: LogsService,
  ) {}

  async onModuleInit() {
    await this.logger.log({
      severity: 'Info',
      summary: 'ValidationRunnerService initialized',
    });
  }

  /**
   * Scheduled job - runs every 30 seconds to check for pipelines that need processing
   */
  @Cron(CronExpression.EVERY_30_SECONDS)
  async processQueue(): Promise<void> {
    if (this.isProcessing) return;

    this.isProcessing = true;

    try {
      await this.processNextPipeline();
    } catch (error) {
      await this.logger.log({
        severity: 'Error',
        summary: 'ValidationRunnerService error',
        details: getReadableError(error),
      });
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Process the next pipeline that needs work
   */
  private async processNextPipeline(): Promise<void> {
    // Find pipeline that needs processing
    const pipeline = await this.prismaService.validationPipeline.findFirst({
      where: {
        status: {
          in: [
            ValidationPipelineStatus.CREATED,
            ValidationPipelineStatus.LAYER_1_DONE,
            ValidationPipelineStatus.LAYER_2_DONE,
            ValidationPipelineStatus.LAYER_3_DONE,
          ],
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    if (!pipeline) {
      // Check for pipelines waiting for user action that need to advance after user selection
      await this.checkUserSelectionProgress();
      return;
    }

    switch (pipeline.status) {
      case ValidationPipelineStatus.CREATED:
        await this.runLayer1(pipeline.id);
        break;
      case ValidationPipelineStatus.LAYER_1_DONE:
        await this.runLayer2(pipeline.id);
        break;
      case ValidationPipelineStatus.LAYER_2_DONE:
        await this.runLayer3(pipeline.id);
        break;
      case ValidationPipelineStatus.LAYER_3_DONE:
        // Move to AWAITING_USER_SELECTION
        await this.pipelineService.updateStatus(
          pipeline.id,
          ValidationPipelineStatus.AWAITING_USER_SELECTION,
        );
        break;
    }
  }

  /**
   * Check if any pipeline needs to advance after user selection
   */
  private async checkUserSelectionProgress(): Promise<void> {
    // Find pipelines where user has selected candidates but hasn't started robustness
    const pipeline = await this.prismaService.validationPipeline.findFirst({
      where: {
        status: ValidationPipelineStatus.AWAITING_USER_SELECTION,
      },
      include: {
        candidates: {
          where: {
            status: 'USER_SELECTED',
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    // If there are user-selected candidates, this pipeline is ready for Layer 5
    if (pipeline && pipeline.candidates.length > 0) {
      // Check if submitUserSelection was called (by checking if any candidates have userSelectedAt)
      const hasUserSelection = pipeline.candidates.some(
        (c) => c.userSelectedAt != null,
      );
      if (hasUserSelection) {
        await this.runLayer5(pipeline.id);
      }
    }

    // Similarly check for final approval
    const finalPipeline = await this.prismaService.validationPipeline.findFirst(
      {
        where: {
          status: ValidationPipelineStatus.LAYER_5_DONE,
        },
        orderBy: { createdAt: 'asc' },
      },
    );

    if (finalPipeline) {
      await this.pipelineService.updateStatus(
        finalPipeline.id,
        ValidationPipelineStatus.AWAITING_FINAL_APPROVAL,
      );
    }
  }

  /**
   * Run Layer 1: Threshold Filter
   */
  private async runLayer1(pipelineId: string): Promise<void> {
    try {
      await this.pipelineService.updateStatus(
        pipelineId,
        ValidationPipelineStatus.LAYER_1_RUNNING,
      );

      await this.thresholdService.runThresholdFilter(pipelineId);
      await this.pipelineService.updateStats(pipelineId);

      await this.pipelineService.updateStatus(
        pipelineId,
        ValidationPipelineStatus.LAYER_1_DONE,
      );

      await this.logger.log({
        severity: 'Info',
        summary: `Layer 1 completed for pipeline ${pipelineId}`,
      });
    } catch (error) {
      await this.pipelineService.updateStatus(
        pipelineId,
        ValidationPipelineStatus.FAILED,
        `Layer 1 failed: ${getReadableError(error)}`,
      );

      await this.logger.log({
        severity: 'Error',
        summary: `Layer 1 failed for pipeline ${pipelineId}`,
        details: getReadableError(error),
      });
    }
  }

  /**
   * Run Layer 2: Pareto Selection
   */
  private async runLayer2(pipelineId: string): Promise<void> {
    try {
      await this.pipelineService.updateStatus(
        pipelineId,
        ValidationPipelineStatus.LAYER_2_RUNNING,
      );

      await this.paretoService.runParetoSelection(pipelineId);
      await this.pipelineService.updateStats(pipelineId);

      await this.pipelineService.updateStatus(
        pipelineId,
        ValidationPipelineStatus.LAYER_2_DONE,
      );

      await this.logger.log({
        severity: 'Info',
        summary: `Layer 2 completed for pipeline ${pipelineId}`,
      });
    } catch (error) {
      await this.pipelineService.updateStatus(
        pipelineId,
        ValidationPipelineStatus.FAILED,
        `Layer 2 failed: ${getReadableError(error)}`,
      );

      await this.logger.log({
        severity: 'Error',
        summary: `Layer 2 failed for pipeline ${pipelineId}`,
        details: getReadableError(error),
      });
    }
  }

  /**
   * Run Layer 3: Walk-Forward Analysis
   */
  private async runLayer3(pipelineId: string): Promise<void> {
    try {
      await this.pipelineService.updateStatus(
        pipelineId,
        ValidationPipelineStatus.LAYER_3_RUNNING,
      );

      await this.wfaService.runWalkForward(pipelineId);
      await this.pipelineService.updateStats(pipelineId);

      await this.pipelineService.updateStatus(
        pipelineId,
        ValidationPipelineStatus.LAYER_3_DONE,
      );

      await this.logger.log({
        severity: 'Info',
        summary: `Layer 3 completed for pipeline ${pipelineId}`,
      });
    } catch (error) {
      await this.pipelineService.updateStatus(
        pipelineId,
        ValidationPipelineStatus.FAILED,
        `Layer 3 failed: ${getReadableError(error)}`,
      );

      await this.logger.log({
        severity: 'Error',
        summary: `Layer 3 failed for pipeline ${pipelineId}`,
        details: getReadableError(error),
      });
    }
  }

  /**
   * Run Layer 5: Robustness Testing (Entry Point Analysis)
   */
  private async runLayer5(pipelineId: string): Promise<void> {
    try {
      await this.pipelineService.updateStatus(
        pipelineId,
        ValidationPipelineStatus.LAYER_5_RUNNING,
      );

      await this.robustnessService.runRobustnessTests(pipelineId);
      await this.pipelineService.updateStats(pipelineId);

      await this.pipelineService.updateStatus(
        pipelineId,
        ValidationPipelineStatus.LAYER_5_DONE,
      );

      await this.logger.log({
        severity: 'Info',
        summary: `Layer 5 completed for pipeline ${pipelineId}`,
      });
    } catch (error) {
      await this.pipelineService.updateStatus(
        pipelineId,
        ValidationPipelineStatus.FAILED,
        `Layer 5 failed: ${getReadableError(error)}`,
      );

      await this.logger.log({
        severity: 'Error',
        summary: `Layer 5 failed for pipeline ${pipelineId}`,
        details: getReadableError(error),
      });
    }
  }
}
