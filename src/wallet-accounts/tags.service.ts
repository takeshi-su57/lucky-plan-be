import { Injectable } from '@nestjs/common';

import { PrismaService } from 'src/global/prisma.service';

import { TagInput } from './dto/tag.input';

@Injectable()
export class TagsService {
  constructor(private prismaService: PrismaService) {}

  upsert(userId: string, tagInput: TagInput) {
    return this.prismaService.tag.upsert({
      where: { userId_tag: { userId, tag: tagInput.tag.toUpperCase() } },
      update: {
        description: tagInput.description,
        color: tagInput.color,
        categoryId: tagInput.categoryId,
      },
      create: {
        userId,
        tag: tagInput.tag.toUpperCase(),
        description: tagInput.description,
        color: tagInput.color,
        categoryId: tagInput.categoryId,
      },
    });
  }

  delete(userId: string, tag: string) {
    return this.prismaService.tag.delete({
      where: {
        userId_tag: { userId, tag: tag.toUpperCase() },
      },
    });
  }

  async removeCategory(userId: string, categoryId: number) {
    await this.prismaService.tag.updateMany({
      where: { categoryId, userId },
      data: {
        categoryId: null,
      },
    });
  }

  findAll(userId: string) {
    return this.prismaService.tag.findMany({
      where: {
        userId,
      },
    });
  }
}
