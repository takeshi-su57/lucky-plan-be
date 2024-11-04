import { Injectable } from '@nestjs/common';

import { CreateBotInput, UpdateBotInput } from './dto/bot.input';
import { PrismaService } from 'src/global/prisma.service';

@Injectable()
export class BotsService {
  constructor(private prismaService: PrismaService) {}

  create(input: CreateBotInput) {
    return this.prismaService.bot.create({
      data: input,
    });
  }

  findAll() {
    return this.prismaService.bot.findMany();
  }

  findOne(id: number) {
    return this.prismaService.bot.findUnique({ where: { id } });
  }

  update(id: number, input: UpdateBotInput) {
    return this.prismaService.bot.update({ where: { id }, data: input });
  }

  remove(id: number) {
    return this.prismaService.bot.delete({ where: { id } });
  }
}
