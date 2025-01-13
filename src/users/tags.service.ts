import { Injectable } from '@nestjs/common';

import { PrismaService } from 'src/global/prisma.service';

import { TagInput } from './dto/tag.input';

@Injectable()
export class TagsService {
  constructor(private prismaService: PrismaService) {}

  upsert(tagInput: TagInput) {
    return this.prismaService.tag.upsert({
      where: { tag: tagInput.tag.toUpperCase() },
      update: {
        description: tagInput.description,
        color: tagInput.color,
      },
      create: {
        tag: tagInput.tag.toUpperCase(),
        description: tagInput.description,
        color: tagInput.color,
      },
    });
  }

  delete(tag: string) {
    return this.prismaService.tag.delete({
      where: {
        tag: tag.toUpperCase(),
      },
    });
  }

  async removeCategory(categoryId: number) {
    await this.prismaService.tag.updateMany({
      where: { categoryId },
      data: {
        categoryId: null,
      },
    });
  }

  findAll() {
    return this.prismaService.tag.findMany();
  }
}
