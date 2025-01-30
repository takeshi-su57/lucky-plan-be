import { Resolver, Mutation, Query } from '@nestjs/graphql';

import { SystemService } from './system.service';

@Resolver()
export class SystemResolver {
  constructor(private readonly systemsService: SystemService) {}

  @Mutation(() => Boolean)
  pauseSystem() {
    return this.systemsService.pauseSystem();
  }

  @Mutation(() => Boolean)
  resumeSystem() {
    return this.systemsService.resumeSystem();
  }

  @Query(() => Boolean)
  systemStatus() {
    return this.systemsService.isSystemPaused();
  }
}
