import { Resolver, Query, Args, Int } from '@nestjs/graphql';
import { MissionsService } from './missions.service';
import { Mission } from './entities/mission.entity';

@Resolver(() => Mission)
export class MissionsResolver {
  constructor(private readonly missionsService: MissionsService) {}

  @Query(() => [Mission])
  findAllMissions() {
    return this.missionsService.findAll();
  }

  @Query(() => Mission)
  findMission(@Args('id', { type: () => Int }) id: number) {
    return this.missionsService.findOne(id);
  }

  @Query(() => Mission)
  findMissionByBot(@Args('botId', { type: () => Int }) botId: number) {
    return this.missionsService.findByBot(botId);
  }
}
