import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';

import { LogsService } from 'src/global/logs.service';

export interface DashboardStatus {
  running: boolean;
  url: string | null;
}

@Injectable()
export class OptunaDashboardService implements OnModuleDestroy {
  private dashboardProcess: ChildProcess | null = null;
  private currentPort: number | null = null;

  constructor(
    private readonly logger: LogsService,
    private readonly configService: ConfigService,
  ) {}

  async onModuleDestroy() {
    await this.stopDashboard();
  }

  /**
   * Get PostgreSQL URL from environment
   */
  private getPostgresUrl(): string {
    const url = this.configService.get<string>('OPTUNA_POSTGRES_URL');
    if (!url) {
      throw new Error(
        'OPTUNA_POSTGRES_URL environment variable is not set. ' +
          'PostgreSQL is required for Optuna storage.',
      );
    }
    return url;
  }

  /**
   * Start global Optuna dashboard
   * Shows all studies - user selects from dropdown in UI
   */
  async startDashboard(port: number = 8080): Promise<DashboardStatus> {
    // Stop existing dashboard if running
    if (this.dashboardProcess) {
      await this.stopDashboard();
    }

    const postgresUrl = this.getPostgresUrl();

    await this.logger.log({
      severity: 'Info',
      summary: 'Starting Optuna dashboard',
      details: `Port: ${port}`,
    });

    const runDashboardScript = path.join(
      process.cwd(),
      'src/backtest/optimizer/run-dashboard.sh',
    );

    // Spawn optuna-dashboard with PostgreSQL URL
    this.dashboardProcess = spawn(
      'bash',
      [runDashboardScript, postgresUrl, String(port)],
      {
        detached: false,
        stdio: 'pipe',
        cwd: process.cwd(),
      },
    );

    this.currentPort = port;

    this.dashboardProcess.on('error', (error) => {
      this.logger.log({
        severity: 'Error',
        summary: 'Optuna dashboard process error',
        details: error.message,
      });
      this.dashboardProcess = null;
      this.currentPort = null;
    });

    this.dashboardProcess.on('exit', (code) => {
      this.logger.log({
        severity: 'Info',
        summary: 'Optuna dashboard process exited',
        details: `Exit code: ${code}`,
      });
      this.dashboardProcess = null;
      this.currentPort = null;
    });

    // Wait for dashboard to start with health check
    const started = await this.waitForDashboard(port);
    if (!started) {
      this.stopDashboard();
      throw new Error('Failed to start Optuna dashboard - health check failed');
    }

    await this.logger.log({
      severity: 'Info',
      summary: 'Optuna dashboard started',
      details: `URL: http://localhost:${port}`,
    });

    return {
      running: true,
      url: `http://localhost:${port}`,
    };
  }

  /**
   * Stop the running dashboard
   */
  async stopDashboard(): Promise<boolean> {
    if (!this.dashboardProcess) {
      return true;
    }

    await this.logger.log({
      severity: 'Info',
      summary: 'Stopping Optuna dashboard',
    });

    try {
      this.dashboardProcess.kill('SIGTERM');
    } catch {
      // Process might already be dead
    }

    this.dashboardProcess = null;
    this.currentPort = null;

    return true;
  }

  /**
   * Wait for dashboard to become available with health check
   */
  private async waitForDashboard(
    port: number,
    maxRetries: number = 15,
    retryDelay: number = 1000,
  ): Promise<boolean> {
    for (let i = 0; i < maxRetries; i++) {
      // Check if process died
      if (!this.dashboardProcess || this.dashboardProcess.killed) {
        return false;
      }

      try {
        const response = await fetch(`http://localhost:${port}/`);
        if (response.ok) {
          return true;
        }
      } catch {
        // Server not ready yet
      }

      await new Promise((resolve) => setTimeout(resolve, retryDelay));
    }

    return false;
  }

  /**
   * Get current dashboard status
   */
  getStatus(): DashboardStatus {
    return {
      running: this.dashboardProcess !== null && !this.dashboardProcess.killed,
      url: this.currentPort ? `http://localhost:${this.currentPort}` : null,
    };
  }
}
