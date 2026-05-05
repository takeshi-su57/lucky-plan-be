import {
  Injectable,
  Inject,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { StrategyCategory } from 'generated/prisma/client';
import { firstValueFrom } from 'rxjs';

import { PrismaService } from 'src/global/prisma.service';
import { PATTERNS, SERVICE_NAMES } from 'src/utils/constants';

import {
  CreateStrategyTemplateInput,
  UpdateStrategyTemplateInput,
} from './dto';
import { StrategyTemplate, StrategyTemplateWithStats } from './entities';

@Injectable()
export class StrategyTemplateService {
  constructor(
    @Inject(SERVICE_NAMES.REDIS_SERVICE) private redisClient: ClientProxy,
    private readonly prismaService: PrismaService,
  ) {}

  /**
   * Create a new strategy template
   */
  async createTemplate(
    input: CreateStrategyTemplateInput,
  ): Promise<StrategyTemplate> {
    // Check name uniqueness
    const existing = await this.prismaService.strategyTemplate.findUnique({
      where: { name: input.name },
    });

    if (existing) {
      throw new ConflictException(
        `Template with name "${input.name}" already exists`,
      );
    }

    const template = await this.prismaService.strategyTemplate.create({
      data: {
        name: input.name,
        description: input.description,
        category: input.category,
        factoryConfig: input.factoryConfig,
      },
    });

    await firstValueFrom(
      this.redisClient.emit(PATTERNS.Backtest.TemplateCreated, template),
    );

    return template;
  }

  /**
   * Update an existing strategy template
   */
  async updateTemplate(
    input: UpdateStrategyTemplateInput,
  ): Promise<StrategyTemplate> {
    const existing = await this.prismaService.strategyTemplate.findUnique({
      where: { id: input.id },
    });

    if (!existing) {
      throw new NotFoundException(`Template ${input.id} not found`);
    }

    // Check name uniqueness if name is being updated
    if (input.name && input.name !== existing.name) {
      const nameConflict = await this.prismaService.strategyTemplate.findUnique(
        {
          where: { name: input.name },
        },
      );

      if (nameConflict) {
        throw new ConflictException(
          `Template with name "${input.name}" already exists`,
        );
      }
    }

    const template = await this.prismaService.strategyTemplate.update({
      where: { id: input.id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.description !== undefined && {
          description: input.description,
        }),
        ...(input.category !== undefined && { category: input.category }),
        ...(input.factoryConfig !== undefined && {
          factoryConfig: input.factoryConfig,
        }),
        ...(input.isActive !== undefined && { isActive: input.isActive }),
      },
    });

    return template;
  }

  /**
   * Get a template by ID
   */
  async getTemplate(id: string): Promise<StrategyTemplate | null> {
    return this.prismaService.strategyTemplate.findUnique({
      where: { id },
    });
  }

  /**
   * Get a template by name
   */
  async getTemplateByName(name: string): Promise<StrategyTemplate | null> {
    return this.prismaService.strategyTemplate.findUnique({
      where: { name },
    });
  }

  /**
   * Get templates with optional filtering
   */
  async getTemplates(options: {
    category?: StrategyCategory;
    isActive?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<StrategyTemplate[]> {
    return this.prismaService.strategyTemplate.findMany({
      where: {
        ...(options.category && { category: options.category }),
        ...(options.isActive !== undefined && { isActive: options.isActive }),
      },
      orderBy: { createdAt: 'desc' },
      take: options.limit || 20,
      skip: options.offset || 0,
    });
  }

  /**
   * Get a template with stats (search count, task count)
   */
  async getTemplateWithStats(
    id: string,
  ): Promise<StrategyTemplateWithStats | null> {
    const template = await this.prismaService.strategyTemplate.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            templateSearches: true,
            backtestTasks: true,
          },
        },
      },
    });

    if (!template) {
      return null;
    }

    return {
      ...template,
      totalSearches: template._count.templateSearches,
      totalTasks: template._count.backtestTasks,
    };
  }

  /**
   * Delete a template with app-level cascading
   * Deletion order (deepest first):
   *   1. ValidationPipeline (ValidationCandidate auto-cascades via DB)
   *   2. BacktestTask (BacktestResult auto-cascades via DB)
   *   3. TemplateSearch
   *   4. StrategyTemplate
   */
  async deleteTemplate(id: string): Promise<boolean> {
    const existing = await this.prismaService.strategyTemplate.findUnique({
      where: { id },
      include: {
        templateSearches: {
          select: { id: true },
        },
      },
    });

    if (!existing) {
      throw new NotFoundException(`Template ${id} not found`);
    }

    const templateSearchIds = existing.templateSearches.map((s) => s.id);

    // Use transaction to ensure atomicity
    await this.prismaService.$transaction(async (tx) => {
      // 1. Find BacktestTasks related to this template
      const tasks = await tx.backtestTask.findMany({
        where: {
          OR: [
            { templateId: id },
            ...(templateSearchIds.length > 0
              ? [{ templateSearchId: { in: templateSearchIds } }]
              : []),
          ],
        },
        select: { id: true },
      });
      const taskIds = tasks.map((t) => t.id);

      // 2. Delete ValidationPipelines linked to these tasks
      // (ValidationCandidates will auto-cascade via DB onDelete: Cascade)
      if (taskIds.length > 0) {
        await tx.validationPipeline.deleteMany({
          where: { backtestTaskId: { in: taskIds } },
        });
      }

      // 3. Delete BacktestTasks
      // (BacktestResults will auto-cascade via DB onDelete: Cascade)
      if (taskIds.length > 0) {
        await tx.backtestTask.deleteMany({
          where: { id: { in: taskIds } },
        });
      }

      // 4. Delete TemplateSearches
      if (templateSearchIds.length > 0) {
        await tx.templateSearch.deleteMany({
          where: { id: { in: templateSearchIds } },
        });
      }

      // 5. Delete the StrategyTemplate
      await tx.strategyTemplate.delete({
        where: { id },
      });
    });

    return true;
  }
}
