import { Resolver, Query, Args, Int, Mutation } from '@nestjs/graphql';
import { MissionsService } from './missions.service';
import { Mission } from './entities/mission.entity';

@Resolver(() => Mission)
export class MissionsResolver {
  constructor(private readonly missionsService: MissionsService) {}

  @Mutation(() => Mission)
  closeMission(@Args('id', { type: () => Int }) id: number) {
    return this.missionsService.closeMission(id);
  }

  @Query(() => [Mission])
  findAllMissions() {
    return this.missionsService.findAll();
  }

  @Query(() => Mission, { nullable: true })
  findMission(@Args('id', { type: () => Int }) id: number) {
    return this.missionsService.findOne(id);
  }

  @Query(() => [Mission])
  findMissionByBot(@Args('botId', { type: () => Int }) botId: number) {
    return this.missionsService.findByBot(botId);
  }
}
