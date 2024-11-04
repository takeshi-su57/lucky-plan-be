import { Injectable } from '@nestjs/common';

import { PrismaService } from 'src/global/prisma.service';

@Injectable()
export class MissionsService {
  constructor(private prismaService: PrismaService) {}

  create(botId: number, targetPositionId: number) {
    return this.prismaService.mission.create({
      data: {
        botId,
        targetPositionId,
      },
    });
  }

  findAll() {
    return this.prismaService.mission.findMany();
  }

  findOne(id: number) {
    return this.prismaService.mission.findUnique({ where: { id } });
  }

  findByBot(botId: number) {
    return this.prismaService.mission.findMany({ where: { botId } });
  }

  attachAchievePositionId(id: number, achievePositionId: number) {
    return this.prismaService.mission.update({
      where: {
        id,
      },
      data: {
        achievePositionId,
      },
    });
  }
}
