import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/global/prisma.service';

@Injectable()
export class ActionsService {
  constructor(private prismaService: PrismaService) {}

  create(name: string, positionId: number, args: string) {
    return this.prismaService.action.create({
      data: {
        name,
        positionId,
        args,
      },
    });
  }

  findAll() {
    return this.prismaService.action.findMany();
  }

  findByPosition(positionId: number) {
    return this.prismaService.action.findMany({ where: { positionId } });
  }

  findOne(id: number) {
    return this.prismaService.action.findUnique({ where: { id } });
  }
}
