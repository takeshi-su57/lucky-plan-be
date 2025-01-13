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

  upsert(input: TagCategoryInput) {
    return this.prismaService.tagCategory.upsert({
      where: { category: input.category.toUpperCase() },
      update: {
        description: input.description,
      },
      create: {
        category: input.category.toUpperCase(),
        description: input.description,
      },
    });
  }

  async delete(id: number) {
    await this.tagsService.removeCategory(id);

    return this.prismaService.tagCategory.delete({
      where: {
        id,
      },
    });
  }

  findAll() {
    return this.prismaService.tag.findMany();
  }
}
