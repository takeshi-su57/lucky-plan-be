import { Injectable, Inject } from '@nestjs/common';

import { ClientProxy } from '@nestjs/microservices';
import { spawn } from 'child_process';
import * as path from 'path';
import * as dayjs from 'dayjs';
import * as utc from 'dayjs/plugin/utc';
import * as timezone from 'dayjs/plugin/timezone';

import 'dotenv';

import { TradingVariableService } from '../../global/trading-variable.service';
import { SecurityService } from '../../global/security.service';
import { ServiceStatus } from 'src/types';

import { delay } from '../../utils';
import { PATTERNS, SERVICE_NAMES } from 'src/utils/constants';

dayjs.extend(utc);
dayjs.extend(timezone);

const microservices = [SERVICE_NAMES.LEADERBOARD_SERVICE];

@Injectable()
export class ApiService {
  isPaused = true;
  stopForTradingVariableLoading = false;

  private serviceStatus: Record<string, ServiceStatus> = {
    [SERVICE_NAMES.LEADERBOARD_SERVICE]: ServiceStatus.KILLED,
  };

  constructor(
    private tradingVariableService: TradingVariableService,
    private securityService: SecurityService,
    @Inject(SERVICE_NAMES.REDIS_SERVICE) private client: ClientProxy,
  ) {
    this.isPaused = true;
    this.stopForTradingVariableLoading = false;

    this.reloadTradingVariables();

    this.resumeSystem('admin');
  }

  updateProcessStatus(service: string, status: ServiceStatus) {
    this.serviceStatus[service] = status;
  }

  async pauseSystem() {
    await this.client.emit(PATTERNS.killProcess, {});

    // wait for all services to be ready
    while (true) {
      await delay(1000);

      console.log('serviceStatus ===>', this.serviceStatus);

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
    // if (this.securityService.isSafeApp) {
    //   if (!password) {
    //     throw new Error('Required Password');
    //   }

    //   await this.securityService.loadPassword(password);
    // }

    for (const service of microservices) {
      const child = spawn('yarn', ['start'], {
        env: {
          ...process.env,
          SERVICE: service,
        },
      });

      child.on('message', (message) => {
        console.log('message ===>', message);
      });

      child.stdout.on('data', (data) => {
        console.log(`[${service}] ${data}`);
      });

      child.stderr.on('data', (data) => {
        console.error(`[${service} error] ${data}`);
      });

      child.on('exit', (code) => {
        console.log(`[${service}] exited with code ${code}`);
      });
    }

    // wait for all services to be ready
    while (true) {
      await delay(10000);

      console.log('serviceStatus ===>', this.serviceStatus);

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
    if (this.tradingVariableService.status !== 'ready') {
      return;
    }

    this.stopForTradingVariableLoading = true;

    const promise = new Promise((resolve) =>
      setTimeout(() => {
        resolve(true);
      }, 20_000),
    );

    await promise;

    this.stopForTradingVariableLoading = false;

    await this.tradingVariableService.loadTradingVariables();

    console.log('trading variables reloaded');
  }

  getServerTime() {
    return {
      timezone: dayjs.tz.guess(),
      timestamp: dayjs().utc().unix(),
    };
  }
}
