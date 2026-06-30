import { Controller } from '@nestjs/common';
import { MessagePattern } from '@nestjs/microservices';
import { Cron, CronExpression } from '@nestjs/schedule';

import { ServiceStatus } from 'src/types';
import { PATTERNS } from 'src/utils/constants';
import { LeaderboardService } from './leaderboard.service';
import { StartAdaptionPayload } from './types';

@Controller()
export class LeaderboardController {
  constructor(private readonly leaderboardService: LeaderboardService) {}

  @MessagePattern(PATTERNS.Leaderboard.GetAdaptionStatus)
  getAdaptionStatus() {
    return this.leaderboardService.getAllStatus();
  }

  @MessagePattern(PATTERNS.Leaderboard.StartAdaption)
  startAdaption(payload: StartAdaptionPayload) {
    this.leaderboardService.startAdaption(
      payload.contractId,
      payload.shouldRestart,
    );

    return true;
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async checkContractsForLeaderboard() {
    const isLeaderboardBusy = Object.values(
      this.leaderboardService.status,
    ).some((status) => status === ServiceStatus.PROCESS);

    if (this.leaderboardService.isReceivedKillProcess || isLeaderboardBusy) {
      return;
    }

    await this.leaderboardService.checkContractsForLeaderboard();
  }
}
