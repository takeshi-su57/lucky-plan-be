import { Injectable } from '@nestjs/common';

import { PrismaService } from 'src/global/prisma.service';

import { TagCategoryInput } from './dto/tag-category.input';
import { TagsService } from './tags.service';

@Injectable()
export class TagCategoriesService {
  constructor(
    private prismaService: PrismaService,
    private tagsService: TagsService,
  ) {}

  upsert(userId: string, input: TagCategoryInput) {
    return this.prismaService.tagCategory.upsert({
      where: {
        userId_category: { userId, category: input.category.toUpperCase() },
      },
      update: {
        description: input.description,
      },
      create: {
        userId,
        category: input.category.toUpperCase(),
        description: input.description,
      },
    });
  }

  async delete(userId: string, id: number) {
    await this.tagsService.removeCategory(userId, id);

    return this.prismaService.tagCategory.delete({
      where: {
        id,
        userId,
      },
    });
  }

  findAll(userId: string) {
    return this.prismaService.tagCategory.findMany({
      where: {
        userId,
      },
    });
  }
}
