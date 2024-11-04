import { Injectable } from '@nestjs/common';
import { TaskStatus } from '@prisma/client';

import { PrismaService } from 'src/global/prisma.service';

@Injectable()
export class TasksService {
  constructor(private prismaService: PrismaService) {}

  create(missionId: number, actionId: number) {
    return this.prismaService.task.create({
      data: {
        missionId,
        actionId,
        status: TaskStatus.Created,
      },
    });
  }

  findAll() {
    return this.prismaService.task.findMany();
  }

  findOne(id: number) {
    return this.prismaService.task.findUnique({ where: { id } });
  }

  findByMission(missionId: number) {
    return this.prismaService.task.findMany({ where: { missionId } });
  }

  updateStatus(id: number, status: TaskStatus) {
    return this.prismaService.task.update({
      where: { id },
      data: {
        status,
      },
    });
  }
}
