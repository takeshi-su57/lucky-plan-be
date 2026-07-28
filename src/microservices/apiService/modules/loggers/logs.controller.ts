import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import { AuthGuard } from '@nestjs/passport';
import { Request, Response } from 'express';
import { UserPermission } from 'generated/prisma/client';

import { PATTERNS } from 'src/utils/constants';

import { LogsService } from './logs.service';
import { CreateLogInput } from './dto/log.dto';

@Controller('admin/logs')
export class LogsController {
  constructor(private readonly logService: LogsService) {}

  @EventPattern(PATTERNS.Log.NativeLogEvent)
  async nativeLog(@Payload() payload: CreateLogInput) {
    await this.logService.nativeLog(payload);
  }

  @EventPattern(PATTERNS.Log.LogEvent)
  async log(@Payload() payload: CreateLogInput) {
    await this.logService.log(payload);
  }

  @Get('download')
  @UseGuards(AuthGuard('jwt'))
  async download(
    @Query('from') from: string,
    @Query('to') to: string,
    @Req() request: Request & { user?: { permission?: UserPermission } },
    @Res() response: Response,
  ) {
    if (request.user?.permission !== UserPermission.Admin) {
      throw new ForbiddenException('An Admin role is required to export logs');
    }
    if (!from || !to) {
      throw new BadRequestException('from and to are required in YYYY-MM-DD format');
    }
    try {
      const stream = await this.logService.createExportStream(from, to);
      response.status(200).set({
        'Content-Type': 'application/gzip',
        'Content-Disposition': `attachment; filename="luckyplans-logs-${from}-to-${to}.jsonl.gz"`,
      });
      stream.on('error', (error) => response.destroy(error)).pipe(response);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Unable to export logs');
    }
  }
}
