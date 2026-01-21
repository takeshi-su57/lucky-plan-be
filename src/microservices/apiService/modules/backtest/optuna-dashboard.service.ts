import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import { LogsService } from 'src/global/logs.service';

export interface DashboardStatus {
  running: boolean;
  taskId: string | null;
  url: string | null;
}

@Injectable()
export class OptunaDashboardService implements OnModuleDestroy {
  private dashboardProcess: ChildProcess | null = null;
  private currentTaskId: string | null = null;
  private currentPort: number | null = null;

  constructor(private readonly logger: LogsService) {}

  async onModuleDestroy() {
    await this.stopDashboard();
  }

  /**
   * Start Optuna dashboard for a specific task
   */
  async startDashboard(
    taskId: string,
    runDate: string,
    port: number = 8080,
  ): Promise<DashboardStatus> {
    // Stop existing dashboard if running
    if (this.dashboardProcess) {
      await this.stopDashboard();
    }

    // Build study path
    const studyDbPath = path.join(
      process.cwd(),
      'result',
      runDate,
      taskId,
      'optuna-study.db',
    );

    // Verify study file exists
    if (!fs.existsSync(studyDbPath)) {
      throw new Error(
        `Optuna study not found for task ${taskId}. Path: ${studyDbPath}`,
      );
    }

    const storageUrl = `sqlite:///${studyDbPath}`;

    await this.logger.log({
      severity: 'Info',
      summary: `Starting Optuna dashboard for task ${taskId}`,
      details: `Storage: ${storageUrl}, Port: ${port}`,
    });

    // Use run-dashboard.sh to properly handle venv activation
    const runDashboardScript = path.join(
      process.cwd(),
      'src/backtest/optimizer/run-dashboard.sh',
    );

    // Spawn optuna-dashboard via shell script
    this.dashboardProcess = spawn(
      'bash',
      [runDashboardScript, storageUrl, String(port)],
      {
        detached: false,
        stdio: 'pipe',
        cwd: process.cwd(),
      },
    );

    this.currentTaskId = taskId;
    this.currentPort = port;

    // Handle process errors
    this.dashboardProcess.on('error', (error) => {
      this.logger.log({
        severity: 'Error',
        summary: 'Optuna dashboard process error',
        details: error.message,
      });
      this.dashboardProcess = null;
      this.currentTaskId = null;
      this.currentPort = null;
    });

    this.dashboardProcess.on('exit', (code) => {
      this.logger.log({
        severity: 'Info',
        summary: 'Optuna dashboard process exited',
        details: `Exit code: ${code}`,
      });
      this.dashboardProcess = null;
      this.currentTaskId = null;
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
      summary: `Optuna dashboard started for task ${taskId}`,
      details: `URL: http://localhost:${port}`,
    });

    return {
      running: true,
      taskId: this.currentTaskId,
      url: `http://localhost:${this.currentPort}`,
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
      details: `Task: ${this.currentTaskId}`,
    });

    try {
      this.dashboardProcess.kill('SIGTERM');
    } catch {
      // Process might already be dead
    }

    this.dashboardProcess = null;
    this.currentTaskId = null;
    this.currentPort = null;

    return true;
  }

  /**
   * Wait for dashboard to become available with health check
   */
  private async waitForDashboard(
    port: number,
    maxRetries: number = 10,
    retryDelay: number = 500,
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
      taskId: this.currentTaskId,
      url: this.currentPort ? `http://localhost:${this.currentPort}` : null,
    };
  }

  /**
   * Find available study dates for a task
   */
  findStudyDates(taskId: string): string[] {
    const resultDir = path.join(process.cwd(), 'result');
    const dates: string[] = [];

    if (!fs.existsSync(resultDir)) {
      return dates;
    }

    // Scan result directories for this taskId
    const entries = fs.readdirSync(resultDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const taskDir = path.join(resultDir, entry.name, taskId);
        const studyPath = path.join(taskDir, 'optuna-study.db');
        if (fs.existsSync(studyPath)) {
          dates.push(entry.name);
        }
      }
    }

    return dates.sort().reverse();
  }
}
