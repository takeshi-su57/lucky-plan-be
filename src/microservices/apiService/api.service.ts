import { Injectable, Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { spawn } from 'child_process';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import 'dotenv';

import { ServiceStatus } from 'src/types';

import { delay } from '../../utils';
import { PATTERNS, SERVICE_NAMES } from 'src/utils/constants';
import { SecurityService } from './modules/security/security.service';

import { LogsService } from 'src/global/logs.service';
import { PrismaService } from 'src/global/prisma.service';
import { LogSeverity } from 'generated/prisma/enums';

dayjs.extend(utc);
dayjs.extend(timezone);

const microservices = [
  SERVICE_NAMES.LEADERBOARD_SERVICE,
  SERVICE_NAMES.TRADING_SERVICE,
];

@Injectable()
export class ApiService {
  isPaused = true;
  private serviceStatus: Record<string, number[]> = {};

  constructor(
    private securityService: SecurityService,
    @Inject(SERVICE_NAMES.REDIS_SERVICE) private client: ClientProxy,
    private prismaService: PrismaService,
    private logger: LogsService,
  ) {
    this.isPaused = true;

    microservices.forEach((service) => {
      this.serviceStatus[service] = [];
    });

    this.init();
  }

  getMicroserviceStatus() {
    return microservices.map((service) => ({
      service,
      pids: this.serviceStatus[service],
    }));
  }

  async updateProcessStatus(
    serviceName: string,
    status: ServiceStatus,
    pid: number,
  ) {
    if (status === ServiceStatus.KILLED) {
      this.serviceStatus[serviceName] = this.serviceStatus[serviceName].filter(
        (pid) => pid !== pid,
      );
    } else {
      this.serviceStatus[serviceName] = [
        ...this.serviceStatus[serviceName].filter((p) => p !== pid),
        pid,
      ];
    }
  }

  async init() {}

  async pauseSystem() {
    await this.client.emit(PATTERNS.killProcessEvent, {});

    // wait for all services to be ready
    while (true) {
      await delay(1000);

      const isAllKilled = microservices.every(
        (service) => this.serviceStatus[service].length === 0,
      );

      if (isAllKilled) {
        break;
      }
    }

    this.isPaused = true;

    return true;
  }

  startSubService(serviceName: string) {
    const child = spawn('yarn', ['start'], {
      env: {
        ...process.env,
        SERVICE: serviceName,
      },
    });

    child.stdout.on('data', (data) => {
      this.logger.log({
        severity: 'Info',
        summary: serviceName,
        details: `${data}`,
      });
    });

    child.stderr.on('data', (data) => {
      this.logger.log({
        severity: 'Error',
        summary: serviceName,
        details: `${data}`,
      });
    });

    child.on('exit', (code) => {
      this.logger.nativeLog({
        severity: 'Info',
        summary: `[${serviceName}] exited with code ${code}`,
      });
    });

    return true;
  }

  async killSubService(serviceName: string) {
    await this.client.emit(PATTERNS.killProcessEvent, { service: serviceName });

    return true;
  }

  async resumeSystem(password: string | null) {
    if (this.securityService.isSafeApp) {
      if (!password) {
        throw new Error('Required Password');
      }

      await this.securityService.loadPassword(password);
    }

    // for (const service of microservices) {
    // this.startSubService(service);
    // }

    // wait for all services to be ready
    // while (true) {
    //   await delay(10000);

    //   const killedServices = microservices.filter(
    //     (service) => this.serviceStatus[service].length === 0,
    //   );

    //   if (killedServices.length === 0) {
    //     break;
    //   }
    // }

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

  getServerTime() {
    return {
      timezone: dayjs.tz.guess(),
      timestamp: dayjs().utc().unix(),
    };
  }

  async cleanDB() {
    await this.prismaService.gnsPricingRecord.deleteMany({
      where: {
        date: {
          lte: dayjs(new Date()).subtract(1, 'month').toDate(),
        },
      },
    });

    await this.prismaService.log.deleteMany({
      where: {
        severity: LogSeverity.Info,
      },
    });
  }
}
