import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  TemplateSearchStatus,
  BacktestTaskStatus,
} from 'generated/prisma/client';
import { firstValueFrom } from 'rxjs';

import { PrismaService } from 'src/global/prisma.service';
import { PATTERNS, SERVICE_NAMES } from 'src/utils/constants';

import {
  CreateTemplateSearchInput,
  TemplateSearchFilterInput,
  OptimizationParams,
} from './dto';
import {
  TemplateSearch,
  TemplateSearchWithTemplate,
  TemplateSearchWithTask,
  TemplateSearchStats,
  BacktestTask,
} from './entities';

@Injectable()
export class TemplateSearchService {
  constructor(
    @Inject(SERVICE_NAMES.REDIS_SERVICE) private redisClient: ClientProxy,
    private readonly prismaService: PrismaService,
  ) {}

  /**
   * Create a new template search and spawn a single BacktestTask
   */
  async createSearch(
    input: CreateTemplateSearchInput,
  ): Promise<TemplateSearchWithTemplate> {
    // Fetch template
    const template = await this.prismaService.strategyTemplate.findUnique({
      where: { id: input.templateId },
    });

    if (!template) {
      throw new NotFoundException(`Template ${input.templateId} not found`);
    }

    if (!template.isActive) {
      throw new BadRequestException(`Template ${template.name} is not active`);
    }

    const searchStrategy = input.searchStrategy || 'optuna';
    const interval = input.interval || '1m';
    const trials = input.trials || 100;
    const optimizationMetrics = input.optimizationMetrics || ['sharpeRatio'];
    const symbol = input.symbol.toUpperCase();

    // Create TemplateSearch record
    const search = await this.prismaService.templateSearch.create({
      data: {
        name: input.name,
        templateId: input.templateId,
        symbol,
        startDate: input.startDate,
        endDate: input.endDate,
        interval,
        searchStrategy,
        status: TemplateSearchStatus.AWAIT,
      },
      include: {
        template: true,
      },
    });

    // Create single BacktestTask for this search
    const factoryConfig =
      template.factoryConfig as unknown as OptimizationParams;

    await this.prismaService.backtestTask.create({
      data: {
        name: `${input.name} - ${symbol}`,
        symbol,
        optimizationParams: factoryConfig as object,
        startDate: input.startDate,
        endDate: input.endDate,
        interval,
        searchStrategy,
        optimizationMetrics,
        trials,
        status: BacktestTaskStatus.AWAIT,
        totalConfigs: searchStrategy === 'optuna' ? trials : 0,
        processedConfigs: 0,
        templateSearchId: search.id,
        templateId: template.id,
      },
    });

    await firstValueFrom(
      this.redisClient.emit(PATTERNS.Backtest.TemplateSearchCreated, search),
    );

    return search;
  }

  /**
   * Get a search by ID
   */
  async getSearch(id: string): Promise<TemplateSearch | null> {
    return this.prismaService.templateSearch.findUnique({
      where: { id },
    });
  }

  /**
   * Get a search with template
   */
  async getSearchWithTemplate(
    id: string,
  ): Promise<TemplateSearchWithTemplate | null> {
    return this.prismaService.templateSearch.findUnique({
      where: { id },
      include: {
        template: true,
      },
    });
  }

  /**
   * Get a search with template and task
   */
  async getSearchWithTask(id: string): Promise<TemplateSearchWithTask | null> {
    return this.prismaService.templateSearch.findUnique({
      where: { id },
      include: {
        template: true,
        task: true,
      },
    });
  }

  /**
   * Get searches with optional filtering
   */
  async getSearches(
    filter?: TemplateSearchFilterInput,
  ): Promise<TemplateSearchWithTemplate[]> {
    return this.prismaService.templateSearch.findMany({
      where: {
        ...(filter?.templateId && { templateId: filter.templateId }),
        ...(filter?.status && { status: filter.status }),
      },
      include: {
        template: true,
      },
      orderBy: { createdAt: 'desc' },
      take: filter?.limit || 20,
      skip: filter?.offset || 0,
    });
  }

  /**
   * Get search statistics by status
   */
  async getSearchStats(): Promise<TemplateSearchStats> {
    const [
      awaitCount,
      processingCount,
      doneCount,
      failedCount,
      cancelledCount,
    ] = await Promise.all([
      this.prismaService.templateSearch.count({
        where: { status: TemplateSearchStatus.AWAIT },
      }),
      this.prismaService.templateSearch.count({
        where: { status: TemplateSearchStatus.PROCESSING },
      }),
      this.prismaService.templateSearch.count({
        where: { status: TemplateSearchStatus.DONE },
      }),
      this.prismaService.templateSearch.count({
        where: { status: TemplateSearchStatus.FAILED },
      }),
      this.prismaService.templateSearch.count({
        where: { status: TemplateSearchStatus.CANCELLED },
      }),
    ]);

    return {
      await: awaitCount,
      processing: processingCount,
      done: doneCount,
      failed: failedCount,
      cancelled: cancelledCount,
    };
  }

  /**
   * Update search status based on task status
   * Called after the task completes
   */
  async updateSearchStatus(searchId: string): Promise<void> {
    const search = await this.prismaService.templateSearch.findUnique({
      where: { id: searchId },
      include: {
        task: {
          select: {
            status: true,
            errorMessage: true,
          },
        },
      },
    });

    if (!search || !search.task) {
      return;
    }

    const taskStatus = search.task.status;

    // Map task status to search status
    let newStatus = search.status;
    let completedAt: Date | null = null;
    let errorMessage: string | null = null;

    if (taskStatus === BacktestTaskStatus.DONE) {
      newStatus = TemplateSearchStatus.DONE;
      completedAt = new Date();
    } else if (taskStatus === BacktestTaskStatus.FAILED) {
      newStatus = TemplateSearchStatus.FAILED;
      completedAt = new Date();
      errorMessage = search.task.errorMessage || 'Task failed';
    } else if (taskStatus === BacktestTaskStatus.CANCELLED) {
      newStatus = TemplateSearchStatus.CANCELLED;
      completedAt = new Date();
    }

    if (newStatus !== search.status) {
      const updated = await this.prismaService.templateSearch.update({
        where: { id: searchId },
        data: {
          status: newStatus,
          ...(completedAt && { completedAt }),
          ...(errorMessage && { errorMessage }),
        },
      });

      await firstValueFrom(
        this.redisClient.emit(PATTERNS.Backtest.TemplateSearchUpdated, updated),
      );
    }
  }

  /**
   * Mark search as PROCESSING and set startedAt
   */
  async markSearchProcessing(id: string): Promise<void> {
    const updated = await this.prismaService.templateSearch.update({
      where: { id },
      data: {
        status: TemplateSearchStatus.PROCESSING,
        startedAt: new Date(),
      },
    });

    await firstValueFrom(
      this.redisClient.emit(PATTERNS.Backtest.TemplateSearchUpdated, updated),
    );
  }

  /**
   * Cancel a search and its task
   */
  async cancelSearch(id: string): Promise<TemplateSearch> {
    const search = await this.prismaService.templateSearch.findUnique({
      where: { id },
    });

    if (!search) {
      throw new NotFoundException(`Search ${id} not found`);
    }

    if (
      search.status !== TemplateSearchStatus.AWAIT &&
      search.status !== TemplateSearchStatus.PROCESSING
    ) {
      throw new BadRequestException(
        'Can only cancel pending or processing searches',
      );
    }

    // Cancel the task for this search
    await this.prismaService.backtestTask.updateMany({
      where: {
        templateSearchId: id,
        status: {
          in: [BacktestTaskStatus.AWAIT, BacktestTaskStatus.PROCESSING],
        },
      },
      data: {
        status: BacktestTaskStatus.CANCELLED,
        completedAt: new Date(),
      },
    });

    // Update search status
    const updated = await this.prismaService.templateSearch.update({
      where: { id },
      data: {
        status: TemplateSearchStatus.CANCELLED,
        completedAt: new Date(),
      },
    });

    await firstValueFrom(
      this.redisClient.emit(PATTERNS.Backtest.TemplateSearchUpdated, updated),
    );

    return updated;
  }

  /**
   * Delete a search and its task
   */
  async deleteSearch(id: string): Promise<boolean> {
    const search = await this.prismaService.templateSearch.findUnique({
      where: { id },
    });

    if (!search) {
      throw new NotFoundException(`Search ${id} not found`);
    }

    // Delete the task associated with this search
    await this.prismaService.backtestTask.deleteMany({
      where: { templateSearchId: id },
    });

    // Delete the search
    await this.prismaService.templateSearch.delete({
      where: { id },
    });

    return true;
  }

  /**
   * Get task by search ID
   */
  async getTaskBySearch(searchId: string): Promise<BacktestTask | null> {
    return this.prismaService.backtestTask.findFirst({
      where: { templateSearchId: searchId },
    });
  }

  /**
   * Get tasks by template ID
   */
  async getTasksByTemplate(templateId: string): Promise<BacktestTask[]> {
    return this.prismaService.backtestTask.findMany({
      where: { templateId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
