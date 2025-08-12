import { Injectable, Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { spawn } from 'child_process';
import * as dayjs from 'dayjs';
import * as utc from 'dayjs/plugin/utc';
import * as timezone from 'dayjs/plugin/timezone';
import 'dotenv';

import { ServiceStatus } from 'src/types';

import { delay } from '../../utils';
import { PATTERNS, SERVICE_NAMES } from 'src/utils/constants';
import { SecurityService } from './modules/security/security.service';
import { BacktestService } from './modules/trade-histories/backtest.service';

import { GnsV10Service } from 'src/global/gnsV10.service';
import { LogsService } from 'src/global/logs.service';

dayjs.extend(utc);
dayjs.extend(timezone);

const microservices = [
  SERVICE_NAMES.LEADERBOARD_SERVICE,
  SERVICE_NAMES.TRADING_SERVICE,
  SERVICE_NAMES.WEB3_SERVICE,
];

@Injectable()
export class ApiService {
  isPaused = true;
  private serviceStatus: Record<string, ServiceStatus> = {};

  constructor(
    private gnsV10Service: GnsV10Service,
    private securityService: SecurityService,
    @Inject(SERVICE_NAMES.REDIS_SERVICE) private client: ClientProxy,
    private backtestService: BacktestService,
    private logger: LogsService,
  ) {
    this.isPaused = true;

    microservices.forEach((service) => {
      this.serviceStatus[service] = ServiceStatus.KILLED;
    });
  }

  async updateProcessStatus(service: string, status: ServiceStatus) {
    if (
      service === SERVICE_NAMES.WEB3_SERVICE &&
      status === ServiceStatus.READY
    ) {
      await this.logger.nativeLog({
        severity: 'Info',
        summary: 'api.service>updateProcessStatus',
        details: `web3 service is ready, reloading trading variables`,
      });

      await this.reloadTradingVariables();

      await this.backtestService.init();
    }

    this.serviceStatus[service] = status;
  }

  async pauseSystem() {
    await this.client.emit(PATTERNS.killProcessEvent, {});

    // wait for all services to be ready
    while (true) {
      await delay(1000);

      const isAllKilled = Object.entries(this.serviceStatus).every(
        ([_, status]) => status === ServiceStatus.KILLED,
      );

      if (isAllKilled) {
        break;
      }
    }

    this.isPaused = true;

    return true;
  }

  async resumeSystem(password: string | null) {
    if (this.securityService.isSafeApp) {
      if (!password) {
        throw new Error('Required Password');
      }

      await this.securityService.loadPassword(password);
    }

    for (const service of microservices) {
      const child = spawn('yarn', ['start'], {
        env: {
          ...process.env,
          SERVICE: service,
        },
      });

      child.stderr.on('data', (data) => {
        console.error(`[${service} error] ${data}`);
      });

      child.on('exit', (code) => {
        this.logger.nativeLog({
          severity: 'Info',
          summary: `[${service}] exited with code ${code}`,
        });
      });
    }

    // wait for all services to be ready
    while (true) {
      await delay(10000);

      const killedServices = Object.entries(this.serviceStatus).filter(
        ([_, status]) => status === 'killed',
      );

      if (killedServices.length === 0) {
        break;
      }
    }

    this.isPaused = false;

    return true;
  }

  async makeSafeApp(password: string) {
    this.isPaused = true;

    const promise = new Promise((resolve, reject) => {
      setTimeout(async () => {
        try {
          const result = await this.securityService.makeSafeApp(password);

          resolve(result);
        } catch (err) {
          reject(err);
        }
      }, 5000);
    });

    const result = await promise;

    if (result) {
      this.isPaused = false;
    }

    return result;
  }

  async changePassword(oldPassword: string, newPassword: string) {
    this.isPaused = true;

    const promise = new Promise((resolve, reject) => {
      setTimeout(async () => {
        try {
          const result = await this.securityService.changePassword(
            oldPassword,
            newPassword,
          );
          resolve(result);
        } catch (err) {
          reject(err);
        }
      }, 5000);
    });

    const result = await promise;

    if (result) {
      this.isPaused = false;
    }

    return result;
  }

  isSystemPaused() {
    return this.isPaused;
  }

  private async reloadTradingVariables() {
    this.gnsV10Service.status = ServiceStatus.PAUSED;

    await delay(20_000);

    await this.gnsV10Service.loadTradingVariables();

    await this.logger.nativeLog({
      severity: 'Info',
      summary: 'api.service>reloadTradingVariables',
      details: 'trading variables reloaded',
    });
  }

  getServerTime() {
    return {
      timezone: dayjs.tz.guess(),
      timestamp: dayjs().utc().unix(),
    };
  }
}
