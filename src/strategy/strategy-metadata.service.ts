import { Injectable } from '@nestjs/common';
import {
  CreateStrategyMetadataInput,
  UpdateStrategyMetadataInput,
} from './dto/strategy-metadata.input';

import { PrismaService } from 'src/global/prisma.service';

@Injectable()
export class StrategyMetadataService {
  constructor(private prismaService: PrismaService) {}

  create(input: CreateStrategyMetadataInput) {
    return this.prismaService.strategyMetadata.create({
      data: input,
    });
  }

  findAll() {
    return this.prismaService.strategyMetadata.findMany();
  }

  findOne(key: string) {
    return this.prismaService.strategyMetadata.findUnique({
      where: {
        key,
      },
    });
  }

  update(key: string, input: UpdateStrategyMetadataInput) {
    return this.prismaService.strategyMetadata.update({
      where: {
        key,
      },
      data: {
        ...input,
      },
    });
  }

  remove(key: string) {
    return this.prismaService.strategyMetadata.delete({
      where: {
        key,
      },
    });
  }
}
