import { Controller } from '@nestjs/common';
import { EventPattern } from '@nestjs/microservices';

import { ServiceStatus } from 'src/types';

import { PATTERNS } from 'src/utils/constants';

import { LogsService } from 'src/global/logs.service';
import { ApiService } from './api.service';

@Controller()
export class ApiController {
  constructor(
    private readonly apiService: ApiService,
    private readonly logger: LogsService,
  ) {}

  @EventPattern(PATTERNS.ProcessStatus)
  updateProcessStatus(data: {
    service: string;
    status: ServiceStatus;
    pid: number;
  }) {
    this.logger.nativeLog({
      severity: 'Info',
      summary: 'UPDATE_PROCESS_STATUS',
      details: JSON.stringify(data),
    });

    this.apiService.updateProcessStatus(data.service, data.status, data.pid);
  }
}
