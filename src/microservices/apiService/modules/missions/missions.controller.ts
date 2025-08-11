import { Controller, Inject } from '@nestjs/common';
import { PubSub } from 'graphql-subscriptions';
import { EventPattern, Payload } from '@nestjs/microservices';

import { PUB_SUB } from 'src/global/global.module';
import { PATTERNS, SUBSCRIPTION_TOKEN } from 'src/utils/constants';
import { MissionBackwardDetails } from './entities/mission.entity';

@Controller()
export class MissionsController {
  constructor(@Inject(PUB_SUB) private readonly pubSub: PubSub) {}

  @EventPattern(PATTERNS.Missions.MissionCreated)
  async handleMissionCreated(@Payload() missions: MissionBackwardDetails[]) {
    this.pubSub.publish(SUBSCRIPTION_TOKEN.missionCreated, {
      [SUBSCRIPTION_TOKEN.missionCreated]: missions,
    });
  }

  @EventPattern(PATTERNS.Missions.MissionUpdated)
  async handleMissionUpdated(@Payload() missions: MissionBackwardDetails[]) {
    this.pubSub.publish(SUBSCRIPTION_TOKEN.missionUpdated, {
      [SUBSCRIPTION_TOKEN.missionUpdated]: missions,
    });
  }
}
