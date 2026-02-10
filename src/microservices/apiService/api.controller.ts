import { Controller } from '@nestjs/common';
import { EventPattern } from '@nestjs/microservices';

import { ServiceStatus } from 'src/types';

import { PATTERNS } from 'src/utils/constants';

import { LogsService } from 'src/global/logs.service';
import { ApiService } from './api.service';
import { PricesService } from './modules/prices/prices.service';

@Controller()
export class ApiController {
  constructor(
    private readonly apiService: ApiService,
    private readonly logger: LogsService,
    private readonly pricesService: PricesService,
  ) {
    // this.pricesService.connectToGnsPriceWsServer();
  }

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
